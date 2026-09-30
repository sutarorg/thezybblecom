-- ============================================================================
-- Zybble — 0002: Zybble AI on the Free plan + bulletproof workspace
-- provisioning/recovery.
--
-- Two production issues are fixed here:
--
--   1. Zybble AI is now included on the Free plan. The `plans` table is the
--      server-side source of truth for every Edge Function entitlement
--      check, so the flag is flipped HERE (not only in the UI). The Free
--      plan keeps every other restriction: 50 leads/month, 1 list, 1 seat,
--      no client workspaces, no priority processing.
--
--   2. Some authenticated users end up with NO workspace (signup trigger
--      missing/failed on an existing database, or a partially-deleted
--      workspace), which made /find unusable ("Your workspace is still
--      loading"). This migration:
--        • rewrites the signup trigger to be idempotent,
--        • adds ensure_personal_workspace() — an RPC any authenticated
--          user can call to (re)provision their personal workspace without
--          ever creating duplicates,
--        • backfills every existing auth user that has no workspace.
--
-- Safe to run repeatedly (idempotent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Zybble AI on Free
-- ---------------------------------------------------------------------------
update plans
set has_ai = true
where id = 'free';

-- ---------------------------------------------------------------------------
-- 2) Idempotent workspace provisioning core
-- ---------------------------------------------------------------------------
-- ensure_personal_workspace_for(u) guarantees the user u is a member of at
-- least one workspace, creating/re-linking a personal workspace only when
-- nothing usable exists. It is safe under concurrency: a per-user advisory
-- lock serializes simultaneous calls, so duplicates cannot be created.
create or replace function ensure_personal_workspace_for(u uuid, display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  name text;
begin
  -- Serialize per-user so concurrent recovery calls can't double-provision.
  perform pg_advisory_xact_lock(hashtext('zybble:ws:' || u::text));

  -- a) Already a member of a workspace? Nothing to do — return the first
  --    workspace they joined (their personal one is created first).
  select m.workspace_id into ws_id
  from workspace_members m
  where m.user_id = u
  order by m.created_at asc
  limit 1;
  if ws_id is not null then
    return ws_id;
  end if;

  -- b) Owns a workspace but the membership row is missing (legacy/partial
  --    provisioning)? Re-link it instead of creating a second workspace.
  select w.id into ws_id
  from workspaces w
  where w.owner_id = u
  order by w.created_at asc
  limit 1;
  if ws_id is not null then
    insert into workspace_members (workspace_id, user_id, role)
    values (ws_id, u, 'owner')
    on conflict (workspace_id, user_id) do nothing;
    return ws_id;
  end if;

  -- c) Nothing exists. Make sure a profile exists, then create the personal
  --    workspace + owner membership.
  if display_name is null or btrim(display_name) = '' then
    select p.name into name from profiles p where p.id = u;
  else
    name := btrim(display_name);
  end if;
  if name is null or name = '' then
    select split_part(a.email, '@', 1) into name
    from auth.users a
    where a.id = u;
  end if;
  name := coalesce(nullif(btrim(coalesce(name, '')), ''), 'My');

  if not exists (select 1 from profiles p where p.id = u) then
    insert into profiles (id, name) values (u, name);
  end if;

  insert into workspaces (name, owner_id, plan_id, is_client)
  values (name || '''s workspace', u, 'free', false)
  returning id into ws_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (ws_id, u, 'owner');

  insert into activity_logs (workspace_id, actor_id, kind, text)
  values (ws_id, u, 'workspace', 'Personal workspace created automatically');

  return ws_id;
end;
$$;

-- Authenticated-user RPC entry point. The anon role cannot call it because
-- auth.uid() is null (raises), and it is revoked from anon explicitly.
create or replace function ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not_authenticated';
  end if;
  return ensure_personal_workspace_for(caller, null);
end;
$$;

-- The internal helper takes an ARBITRARY user id, so it must only be
-- executable by its owner (the migration role / signup trigger), never by
-- anon or authenticated callers directly. Users go through the pinned
-- ensure_personal_workspace() RPC above instead.
revoke execute on function ensure_personal_workspace_for(uuid, text) from public, anon, authenticated;
revoke execute on function ensure_personal_workspace() from public, anon;
grant execute on function ensure_personal_workspace() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Robust signup trigger (idempotent, shares the same core)
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Idempotent: re-running (or a retried signup) never duplicates anything.
  insert into profiles (id, name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  perform ensure_personal_workspace_for(
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1))
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- 4) One-time backfill: every existing user with no workspace gets one
-- ---------------------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select a.id, coalesce(nullif(btrim(a.raw_user_meta_data->>'name'), ''), split_part(a.email, '@', 1)) as name
    from auth.users a
    where not exists (select 1 from workspace_members m where m.user_id = a.id)
  loop
    begin
      perform ensure_personal_workspace_for(u.id, u.name);
    exception when others then
      raise warning 'workspace backfill failed for user %: %', u.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Keep the seeded plans table in sync with the shipped catalog
--    (has_ai now true on Free; all other Free restrictions unchanged).
-- ---------------------------------------------------------------------------
insert into plans (id, price_cents, lead_allowance, max_lists, max_users, has_ai, client_workspaces, priority_processing)
values
  ('free',   0,     50,     1,  1, true,  false, false),
  ('growth', 4900,  5000,   -1,  1, true,  false, false),
  ('agency', 9900,  15000,  -1,  3, true,  true,  false),
  ('scale',  19900, 50000,  -1,  5, true,  true,  true)
on conflict (id) do update set
  price_cents = excluded.price_cents,
  lead_allowance = excluded.lead_allowance,
  max_lists = excluded.max_lists,
  max_users = excluded.max_users,
  has_ai = excluded.has_ai,
  client_workspaces = excluded.client_workspaces,
  priority_processing = excluded.priority_processing;
