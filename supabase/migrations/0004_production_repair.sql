-- ============================================================================
-- Zybble — 0004 production data-model repair.
-- Adds trustworthy business-size metadata, popular-times storage, persistent
-- preferences, app-session tracking, tag validation, usage increments, and
-- removes the legacy `enriched` lead status.
-- Safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Lead metadata: business size + popular times
-- ---------------------------------------------------------------------------
alter table leads add column if not exists business_size text not null default 'unknown';
alter table leads add column if not exists employee_count integer;
alter table leads add column if not exists business_size_source text not null default 'unknown';
alter table leads add column if not exists business_size_confidence numeric(3,2) not null default 0;
alter table leads add column if not exists popular_times jsonb not null default '{}'::jsonb;

alter table leads drop constraint if exists leads_business_size_check;
alter table leads add constraint leads_business_size_check
  check (business_size in ('unknown','small','medium','enterprise'));

alter table leads drop constraint if exists leads_employee_count_check;
alter table leads add constraint leads_employee_count_check
  check (employee_count is null or employee_count >= 1);

alter table leads drop constraint if exists leads_business_size_source_check;
alter table leads add constraint leads_business_size_source_check
  check (business_size_source in ('unknown','provider','website'));

alter table leads drop constraint if exists leads_business_size_confidence_check;
alter table leads add constraint leads_business_size_confidence_check
  check (business_size_confidence >= 0 and business_size_confidence <= 1);

create index if not exists leads_business_size_idx on leads (workspace_id, business_size);
create index if not exists leads_tags_gin_idx on leads using gin (tags);

-- ---------------------------------------------------------------------------
-- Status repair: legacy `enriched` meant "not contacted yet". Convert it to
-- `new`, then enforce the final two-status workflow.
-- ---------------------------------------------------------------------------
update leads set status = 'new' where status = 'enriched';

alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check
  check (status in ('new','contacted'));

-- ---------------------------------------------------------------------------
-- One-word tag validation. Existing legacy invalid arrays are left untouched
-- until a user edits tags; all new tag writes are normalized and validated.
-- ---------------------------------------------------------------------------
create or replace function validate_lead_tags()
returns trigger
language plpgsql
as $$
declare
  tag text;
  cleaned text[] := '{}';
  normalized text;
begin
  if new.tags is null then
    new.tags := '{}';
    return new;
  end if;

  foreach tag in array new.tags loop
    normalized := lower(btrim(tag));
    if normalized = '' then
      raise exception 'invalid_tag_empty';
    end if;
    if normalized ~ '\s' then
      raise exception 'invalid_tag_one_word';
    end if;
    if normalized !~ '^[a-z0-9][a-z0-9_-]{0,31}$' then
      raise exception 'invalid_tag_format';
    end if;
    if not normalized = any(cleaned) then
      cleaned := array_append(cleaned, normalized);
    end if;
  end loop;
  new.tags := cleaned;
  return new;
end;
$$;

drop trigger if exists leads_validate_tags on leads;
create trigger leads_validate_tags
before insert or update of tags on leads
for each row execute function validate_lead_tags();

-- ---------------------------------------------------------------------------
-- Persistent user preferences.
-- ---------------------------------------------------------------------------
create table if not exists user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  appearance text not null default 'system' check (appearance in ('system','light','dark')),
  timezone text not null default 'UTC',
  language text not null default 'en' check (language in ('en','es','fr','de')),
  date_format text not null default 'MMM D, YYYY' check (date_format in ('MMM D, YYYY','D MMM YYYY','YYYY-MM-DD')),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_preferences_updated_at on user_preferences;
create trigger user_preferences_updated_at before update on user_preferences
for each row execute function set_updated_at();

alter table user_preferences enable row level security;
drop policy if exists "preferences owner all" on user_preferences;
create policy "preferences owner all" on user_preferences
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- App-level session tracking. This does not fabricate Supabase Auth sessions;
-- it records observed signed-in browser sessions and lets the app revoke them.
-- ---------------------------------------------------------------------------
create table if not exists app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, session_id)
);

create index if not exists app_sessions_user_seen_idx on app_sessions (user_id, last_seen_at desc);

alter table app_sessions enable row level security;
drop policy if exists "app sessions owner all" on app_sessions;
create policy "app sessions owner all" on app_sessions
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Workspace-scoped usage counter increments for same-origin API routes. The
-- caller must be an authenticated workspace member.
-- ---------------------------------------------------------------------------
create or replace function increment_usage_counter(ws uuid, metric text, delta integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_start date := date_trunc('month', now())::date;
  caller uuid := auth.uid();
begin
  if caller is null or not is_workspace_member(ws) then
    raise exception 'not_authorized';
  end if;

  insert into usage_counters (workspace_id, period_start)
  values (ws, p_start)
  on conflict (workspace_id, period_start) do nothing;

  if metric = 'exports' then
    update usage_counters set exports = greatest(0, exports + delta), updated_at = now()
    where workspace_id = ws and period_start = p_start;
  elsif metric = 'ai_runs' then
    update usage_counters set ai_runs = greatest(0, ai_runs + delta), updated_at = now()
    where workspace_id = ws and period_start = p_start;
  elsif metric = 'searches' then
    update usage_counters set searches = greatest(0, searches + delta), updated_at = now()
    where workspace_id = ws and period_start = p_start;
  else
    raise exception 'invalid_usage_metric';
  end if;
end;
$$;

revoke execute on function increment_usage_counter(uuid, text, integer) from public, anon;
grant execute on function increment_usage_counter(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Correct atomic lead reservation: refunds must not increment `searches`.
-- ---------------------------------------------------------------------------
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
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.user_id = (select owner_id from workspaces where id = ws)
    and s.status in ('active','trialing')
  limit 1;

  if allowance is null then
    select lead_allowance into allowance from plans where id = 'free';
  end if;

  if caller is not null and not is_workspace_member(ws) then
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
