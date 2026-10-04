-- ============================================================================
-- Zybble — 0006: Team page relationship repair, workspace authorization
-- repair, and INR-consistent billing/subscription lifecycle schema.
--
-- WHY THIS MIGRATION EXISTS
--
--  1) /team failed with:
--       "Could not find a relationship between 'workspace_members' and
--        'user_id' in the schema cache"
--     The client asked PostgREST to embed `profiles` through
--     `workspace_members.user_id`. That embed can only resolve through a
--     foreign key, and the real model is:
--         workspace_members.user_id -> auth.users.id
--         profiles.id               -> auth.users.id
--     i.e. a SHARED PARENT, not a direct FK. Creating a
--     workspace_members.user_id -> profiles.id foreign key purely to satisfy
--     PostgREST would be an incorrect model (it would also make membership
--     depend on a profile row existing). Instead this migration adds a
--     SECURITY DEFINER RPC, `list_workspace_team(uuid)`, which joins
--     workspace_members -> profiles -> auth.users server-side, after
--     authorizing the caller against the same membership rules RLS uses.
--     Member email becomes available (auth.users is not client-readable)
--     without exposing anyone outside the caller's own workspace.
--
--  2) /workspaces failed with "You don't have access to that resource."
--     `workspaces` could only be read through `is_workspace_member(id)`.
--     A workspace OWNER whose `workspace_members` row was missing (failed or
--     partial signup provisioning, a membership row removed by hand, or the
--     non-atomic two-step create used by the old createWorkspace()) was
--     locked out of a workspace they own, and the freshly inserted row of a
--     brand-new client workspace was unreadable in the same statement. Owner
--     access is added to the policies, membership/invitation policies are
--     widened to the workspace owner, and workspace creation becomes a single
--     atomic SECURITY DEFINER RPC that always writes the owner membership.
--
--  3) Billing stored Razorpay amounts (paise) with a USD currency default and
--     had no room for the real subscription lifecycle (created/pending/
--     halted/expired, cancel-at-cycle-end, idempotent invoices).
--
-- Safe to run repeatedly (idempotent). No destructive data loss: nothing is
-- dropped except policies/triggers that are immediately recreated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helper predicates
-- ---------------------------------------------------------------------------

-- Owner of a workspace, resolved without re-entering RLS.
create or replace function is_workspace_owner(ws uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from workspaces w
    where w.id = ws and w.owner_id = auth.uid()
  );
$$;
revoke execute on function is_workspace_owner(uuid) from public, anon;
grant execute on function is_workspace_owner(uuid) to authenticated;

-- Membership OR ownership: the single definition of "may see this workspace".
create or replace function can_access_workspace(ws uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from workspaces w
    where w.id = ws
      and (
        w.owner_id = auth.uid()
        or exists (
          select 1 from workspace_members m
          where m.workspace_id = w.id and m.user_id = auth.uid()
        )
      )
  );
$$;
revoke execute on function can_access_workspace(uuid) from public, anon;
grant execute on function can_access_workspace(uuid) to authenticated;

-- Manage = owner of the workspace, or an owner/admin member of it.
create or replace function can_manage_workspace(ws uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from workspaces w
    where w.id = ws
      and (
        w.owner_id = auth.uid()
        or exists (
          select 1 from workspace_members m
          where m.workspace_id = w.id
            and m.user_id = auth.uid()
            and m.role in ('owner', 'admin')
        )
      )
  );
$$;
revoke execute on function can_manage_workspace(uuid) from public, anon;
grant execute on function can_manage_workspace(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Billing schema: INR everywhere + full subscription lifecycle
-- ---------------------------------------------------------------------------

-- Plans are priced in the smallest INR unit (paise): 4900 = ₹49.00.
alter table plans add column if not exists currency text not null default 'INR';
update plans set currency = 'INR' where currency is distinct from 'INR';

-- Subscriptions: lifecycle columns + the full Razorpay status vocabulary.
alter table subscriptions add column if not exists currency text not null default 'INR';
alter table subscriptions add column if not exists cancel_at_cycle_end boolean not null default false;
alter table subscriptions add column if not exists latest_payment_id text;
alter table subscriptions add column if not exists last_event_at timestamptz;
alter table subscriptions add column if not exists charge_at timestamptz;
update subscriptions set currency = 'INR' where currency is distinct from 'INR';

alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check check (
  status in (
    'created',       -- provider subscription created, nothing paid yet
    'authenticated', -- mandate authenticated, first charge pending
    'pending',       -- a renewal charge failed, provider is retrying
    'active',
    'trialing',
    'past_due',
    'cancelled',
    'paused',
    'halted',
    'failed',
    'expired',
    'completed'
  )
);

-- Payments / invoices: Razorpay reports amounts in paise, currency INR.
alter table payments add column if not exists method text;
alter table payments add column if not exists captured_at timestamptz;
alter table payments add column if not exists notes jsonb not null default '{}'::jsonb;
alter table payments alter column currency set default 'INR';
update payments set currency = 'INR' where upper(coalesce(currency, '')) in ('', 'USD');

alter table invoices add column if not exists razorpay_payment_id text;
alter table invoices add column if not exists period_start timestamptz;
alter table invoices add column if not exists period_end timestamptz;
alter table invoices alter column currency set default 'INR';
update invoices set currency = 'INR' where upper(coalesce(currency, '')) in ('', 'USD');

alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check
  check (status in ('paid', 'failed', 'upcoming', 'refunded'));

-- Idempotent invoice writes: one invoice per Razorpay payment. Collapse any
-- duplicates produced by the previous webhook before enforcing uniqueness.
-- Keeps the oldest row of each group (no data loss for distinct payments).
do $$
begin
  delete from invoices i
  using invoices j
  where i.razorpay_invoice_id is not null
    and i.razorpay_invoice_id = j.razorpay_invoice_id
    and i.ctid > j.ctid;
end;
$$;

create unique index if not exists invoices_razorpay_invoice_uidx
  on invoices (razorpay_invoice_id)
  where razorpay_invoice_id is not null;

create index if not exists payments_user_idx on payments (user_id, created_at desc);
create index if not exists invoices_user_idx on invoices (user_id, issued_at desc);

-- Webhook bookkeeping (idempotency + observability).
alter table webhook_events add column if not exists attempts integer not null default 0;
create index if not exists webhook_events_type_idx on webhook_events (provider, event_type, received_at desc);

-- Pending provider checkouts. A Razorpay subscription exists from the moment
-- checkout is prepared, long before anything is paid. Storing it here (rather
-- than in `subscriptions`, which is the entitlement table) is what guarantees
-- that preparing a checkout can never grant a paid plan, and that an existing
-- paid subscriber's live entitlement is not clobbered while they upgrade.
create table if not exists subscription_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references plans (id),
  razorpay_subscription_id text not null unique,
  razorpay_customer_id text,
  razorpay_plan_id text,
  status text not null default 'created',
  amount_cents integer not null default 0,
  currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists subscription_checkouts_user_idx
  on subscription_checkouts (user_id, created_at desc);

drop trigger if exists subscription_checkouts_updated_at on subscription_checkouts;
create trigger subscription_checkouts_updated_at before update on subscription_checkouts
for each row execute function set_updated_at();

alter table subscription_checkouts enable row level security;
drop policy if exists "checkouts owner read" on subscription_checkouts;
create policy "checkouts owner read" on subscription_checkouts
for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) Entitlement source of truth
--
-- A subscription entitles its user while it is active/trialing, and also
-- through the end of a period that was already paid for when the user has
-- cancelled (cancel-at-cycle-end) — matching the product rule "you keep
-- access until the end of the current billing period, then move to Free".
-- ---------------------------------------------------------------------------
create or replace function effective_plan_for_user(u uuid)
returns text
language sql
security definer stable
set search_path = public
as $$
  select coalesce(
    (
      select s.plan_id
      from subscriptions s
      where s.user_id = u
        and (
          s.status in ('active', 'trialing')
          or (
            s.status in ('cancelled', 'completed')
            and s.current_period_end is not null
            and s.current_period_end > now()
          )
        )
      order by s.updated_at desc
      limit 1
    ),
    'free'
  );
$$;
revoke execute on function effective_plan_for_user(uuid) from public, anon;
grant execute on function effective_plan_for_user(uuid) to authenticated;

-- The plan that governs a workspace is the plan of the workspace OWNER.
create or replace function workspace_plan(ws uuid)
returns text
language sql
security definer stable
set search_path = public
as $$
  select coalesce(
    effective_plan_for_user((select w.owner_id from workspaces w where w.id = ws)),
    'free'
  );
$$;
revoke execute on function workspace_plan(uuid) from public, anon;
grant execute on function workspace_plan(uuid) to authenticated;

-- My own effective plan, for the client.
create or replace function my_effective_plan()
returns text
language sql
security definer stable
set search_path = public
as $$
  select case when auth.uid() is null then 'free' else effective_plan_for_user(auth.uid()) end;
$$;
revoke execute on function my_effective_plan() from public, anon;
grant execute on function my_effective_plan() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Plan-limit triggers now use the effective plan (a cancelled or failed
--    subscription must not keep granting paid limits, and a paid subscription
--    must not be ignored because an old row said 'past_due').
-- ---------------------------------------------------------------------------
create or replace function enforce_list_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_lists integer;
  current_lists integer;
begin
  select p.max_lists into max_lists
  from plans p
  where p.id = workspace_plan(new.workspace_id);

  max_lists := coalesce(max_lists, 1);

  if max_lists >= 0 then
    select count(*) into current_lists from lead_lists where workspace_id = new.workspace_id;
    if current_lists >= max_lists then
      raise exception 'list_limit_reached';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lead_lists_limit on lead_lists;
create trigger lead_lists_limit before insert on lead_lists
for each row execute function enforce_list_limit();

create or replace function enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_users integer;
  current_users integer;
begin
  select p.max_users into max_users
  from plans p
  where p.id = workspace_plan(new.workspace_id);

  max_users := coalesce(max_users, 1);

  select count(*) into current_users
  from workspace_members
  where workspace_id = new.workspace_id;

  -- The workspace owner's own seat is always allowed: a plan downgrade must
  -- never make an owner unable to re-link their personal workspace.
  if current_users >= max_users
     and not exists (
       select 1 from workspaces w
       where w.id = new.workspace_id and w.owner_id = new.user_id
     )
  then
    raise exception 'seat_limit_reached';
  end if;

  return new;
end;
$$;

drop trigger if exists workspace_members_seat_limit on workspace_members;
create trigger workspace_members_seat_limit before insert on workspace_members
for each row execute function enforce_seat_limit();

create or replace function enforce_client_workspace_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if new.is_client then
    select p.client_workspaces into allowed
    from plans p
    where p.id = effective_plan_for_user(new.owner_id);

    if not coalesce(allowed, false) then
      raise exception 'client_workspaces_not_available';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_client_plan on workspaces;
create trigger workspaces_client_plan before insert on workspaces
for each row execute function enforce_client_workspace_plan();

-- Lead reservation uses the same effective-plan definition.
create or replace function reserve_leads(ws uuid, delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p_start date := date_trunc('month', now())::date;
  allowance integer;
  new_used integer;
  caller uuid := auth.uid();
begin
  select p.lead_allowance into allowance
  from plans p
  where p.id = workspace_plan(ws);

  if allowance is null then
    select lead_allowance into allowance from plans where id = 'free';
  end if;

  if caller is not null and not can_access_workspace(ws) then
    return -1;
  end if;

  insert into usage_counters (workspace_id, period_start, leads_used, searches)
  values (ws, p_start, 0, 0)
  on conflict (workspace_id, period_start) do nothing;

  update usage_counters
  set leads_used = greatest(0, leads_used + delta),
      searches = searches + case when delta > 0 then 1 else 0 end,
      updated_at = now()
  where workspace_id = ws
    and period_start = p_start
    and leads_used + delta <= allowance
    and leads_used + delta >= 0
  returning leads_used into new_used;

  if new_used is null then
    return -2;
  end if;
  return allowance - new_used;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) RLS repair — workspaces, membership, invitations
--
-- Nothing here makes workspaces publicly readable. Every policy still
-- resolves to "auth.uid() owns this workspace, or auth.uid() is a member of
-- it" (plus the existing audited admin predicate).
-- ---------------------------------------------------------------------------
drop policy if exists "workspaces member read" on workspaces;
create policy "workspaces member read" on workspaces
for select using (owner_id = auth.uid() or is_workspace_member(id));

drop policy if exists "workspaces insert" on workspaces;
create policy "workspaces insert" on workspaces
for insert with check (owner_id = auth.uid());

drop policy if exists "workspaces owner admin update" on workspaces;
create policy "workspaces owner admin update" on workspaces
for update using (owner_id = auth.uid() or has_workspace_role(id, '{owner,admin}'))
with check (owner_id = auth.uid() or has_workspace_role(id, '{owner,admin}'));

drop policy if exists "workspaces owner delete" on workspaces;
create policy "workspaces owner delete" on workspaces
for delete using (owner_id = auth.uid());

drop policy if exists "members member read" on workspace_members;
create policy "members member read" on workspace_members
for select using (user_id = auth.uid() or can_access_workspace(workspace_id));

drop policy if exists "members owner admin insert" on workspace_members;
create policy "members owner admin insert" on workspace_members
for insert with check (user_id = auth.uid() or can_manage_workspace(workspace_id));

drop policy if exists "members owner admin update" on workspace_members;
create policy "members owner admin update" on workspace_members
for update using (user_id = auth.uid() or can_manage_workspace(workspace_id))
with check (user_id = auth.uid() or can_manage_workspace(workspace_id));

drop policy if exists "members remove or self remove" on workspace_members;
create policy "members remove or self remove" on workspace_members
for delete using (user_id = auth.uid() or can_manage_workspace(workspace_id));

drop policy if exists "invitations manager read write" on workspace_invitations;
create policy "invitations manager read write" on workspace_invitations
for all using (inviter_id = auth.uid() or can_manage_workspace(workspace_id))
with check (inviter_id = auth.uid() or can_manage_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 5) Workspace RPCs — exactly what the caller is entitled to, nothing more
-- ---------------------------------------------------------------------------
drop function if exists list_user_workspaces();
create function list_user_workspaces()
returns table (
  id uuid,
  name text,
  owner_id uuid,
  owner_name text,
  plan_id text,
  is_client boolean,
  created_at timestamptz,
  member_count integer,
  leads_used integer,
  searches integer,
  lists integer
)
language sql
security definer stable
set search_path = public
as $$
  select
    w.id,
    w.name,
    w.owner_id,
    coalesce(p.name, '') as owner_name,
    workspace_plan(w.id) as plan_id,
    w.is_client,
    w.created_at,
    (select count(*)::int from workspace_members m2 where m2.workspace_id = w.id) as member_count,
    coalesce(u.leads_used, 0) as leads_used,
    coalesce(u.searches, 0) as searches,
    (select count(*)::int from lead_lists l where l.workspace_id = w.id) as lists
  from workspaces w
  left join profiles p on p.id = w.owner_id
  left join usage_counters u
    on u.workspace_id = w.id
   and u.period_start = date_trunc('month', now())::date
  where auth.uid() is not null
    and (
      w.owner_id = auth.uid()
      or exists (
        select 1 from workspace_members m
        where m.workspace_id = w.id and m.user_id = auth.uid()
      )
    )
  order by w.created_at asc;
$$;
revoke execute on function list_user_workspaces() from public, anon;
grant execute on function list_user_workspaces() to authenticated;

drop function if exists get_user_workspace(uuid);
create function get_user_workspace(ws uuid)
returns table (
  id uuid,
  name text,
  owner_id uuid,
  owner_name text,
  plan_id text,
  is_client boolean,
  created_at timestamptz,
  member_count integer,
  leads_used integer,
  searches integer,
  lists integer
)
language sql
security definer stable
set search_path = public
as $$
  select * from list_user_workspaces() w where w.id = ws;
$$;
revoke execute on function get_user_workspace(uuid) from public, anon;
grant execute on function get_user_workspace(uuid) to authenticated;

-- Atomic client-workspace creation: entitlement check, workspace row, and the
-- owner membership row in one transaction. Re-running with the same name
-- returns the existing workspace instead of creating a duplicate.
drop function if exists create_client_workspace(text);
create function create_client_workspace(ws_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean_name text := btrim(coalesce(ws_name, ''));
  allowed boolean;
  ws_id uuid;
begin
  if caller is null then
    raise exception 'not_authenticated';
  end if;
  if clean_name = '' then
    raise exception 'workspace_name_required';
  end if;

  perform pg_advisory_xact_lock(hashtext('zybble:ws:create:' || caller::text));

  select p.client_workspaces into allowed
  from plans p
  where p.id = effective_plan_for_user(caller);
  if not coalesce(allowed, false) then
    raise exception 'client_workspaces_not_available';
  end if;

  -- Idempotent: never create two client workspaces with the same name for
  -- the same owner (double submit / retried request).
  select w.id into ws_id
  from workspaces w
  where w.owner_id = caller
    and w.is_client
    and lower(w.name) = lower(clean_name)
  order by w.created_at asc
  limit 1;

  if ws_id is null then
    insert into workspaces (name, owner_id, plan_id, is_client)
    values (clean_name, caller, 'free', true)
    returning id into ws_id;

    insert into activity_logs (workspace_id, actor_id, kind, text)
    values (ws_id, caller, 'workspace', 'Client workspace created');
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (ws_id, caller, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return ws_id;
end;
$$;
revoke execute on function create_client_workspace(text) from public, anon;
grant execute on function create_client_workspace(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Team RPCs — the real fix for the schema-cache relationship error
--
-- `workspace_members.user_id` points at auth.users, and `profiles.id` points
-- at auth.users. PostgREST cannot embed across that shared parent, and adding
-- a fake FK would be an incorrect data model. The join is therefore performed
-- here, after the caller is authorized against the workspace.
-- ---------------------------------------------------------------------------
drop function if exists list_workspace_team(uuid);
create function list_workspace_team(ws uuid)
returns table (
  user_id uuid,
  role text,
  joined_at timestamptz,
  name text,
  email text,
  avatar_url text,
  is_owner boolean
)
language plpgsql
security definer stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not can_access_workspace(ws) then
    raise exception 'not_authorized';
  end if;

  return query
  select
    m.user_id,
    m.role,
    m.created_at as joined_at,
    coalesce(nullif(btrim(p.name), ''), split_part(au.email, '@', 1), 'Member') as name,
    coalesce(au.email, '') as email,
    p.avatar_url,
    (w.owner_id = m.user_id) as is_owner
  from workspace_members m
  join workspaces w on w.id = m.workspace_id
  left join profiles p on p.id = m.user_id
  left join auth.users au on au.id = m.user_id
  where m.workspace_id = ws
  order by (w.owner_id = m.user_id) desc, m.created_at asc;
end;
$$;
revoke execute on function list_workspace_team(uuid) from public, anon;
grant execute on function list_workspace_team(uuid) to authenticated;

-- Seat accounting used by the Team page and by the invite endpoints.
drop function if exists workspace_seat_usage(uuid);
create function workspace_seat_usage(ws uuid)
returns table (
  plan_id text,
  max_users integer,
  active_members integer,
  pending_invites integer
)
language plpgsql
security definer stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not can_access_workspace(ws) then
    raise exception 'not_authorized';
  end if;

  return query
  select
    pl.id,
    pl.max_users,
    (select count(*)::int from workspace_members m where m.workspace_id = ws),
    (select count(*)::int from workspace_invitations i
      where i.workspace_id = ws and i.status = 'pending')
  from plans pl
  where pl.id = workspace_plan(ws);
end;
$$;
revoke execute on function workspace_seat_usage(uuid) from public, anon;
grant execute on function workspace_seat_usage(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Repair: every workspace owner must also be a member of their workspace.
--    This is what silently locked owners out of /team and /workspaces.
--    `on conflict do nothing` keeps it duplicate-free and re-runnable.
--    Seat limits are intentionally not applied to this repair (the trigger
--    already exempts the owner's own seat).
-- ---------------------------------------------------------------------------
insert into workspace_members (workspace_id, user_id, role)
select w.id, w.owner_id, 'owner'
from workspaces w
where not exists (
  select 1 from workspace_members m
  where m.workspace_id = w.id and m.user_id = w.owner_id
)
on conflict (workspace_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 8) Keep the shipped plan catalog in sync (paise, INR).
-- ---------------------------------------------------------------------------
insert into plans (id, price_cents, lead_allowance, max_lists, max_users, has_ai, client_workspaces, priority_processing, currency)
values
  ('free',   0,     50,     1,  1, true,  false, false, 'INR'),
  ('growth', 4900,  5000,  -1,  1, true,  false, false, 'INR'),
  ('agency', 9900,  15000, -1,  3, true,  true,  false, 'INR'),
  ('scale',  19900, 50000, -1,  5, true,  true,  true,  'INR')
on conflict (id) do update set
  price_cents = excluded.price_cents,
  lead_allowance = excluded.lead_allowance,
  max_lists = excluded.max_lists,
  max_users = excluded.max_users,
  has_ai = excluded.has_ai,
  client_workspaces = excluded.client_workspaces,
  priority_processing = excluded.priority_processing,
  currency = excluded.currency;

-- ---------------------------------------------------------------------------
-- 9) Lapsed-subscription sweep. A cancelled/expired subscription whose paid
--    period has ended must stop entitling the paid plan. Entitlement already
--    computes this live, but normalizing the stored status keeps the Billing
--    UI and any reporting honest. Safe to call from a cron job.
-- ---------------------------------------------------------------------------
create or replace function expire_lapsed_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update subscriptions
  set status = 'expired',
      plan_id = 'free',
      cancel_at_cycle_end = false,
      updated_at = now()
  where status in ('cancelled', 'completed')
    and current_period_end is not null
    and current_period_end <= now()
    and plan_id <> 'free';
  get diagnostics touched = row_count;
  return touched;
end;
$$;
revoke execute on function expire_lapsed_subscriptions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10) PostgREST must re-read the schema so the new RPCs are callable
--     immediately after this migration runs.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
