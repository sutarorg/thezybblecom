-- ============================================================================
-- 0008 — Zybble admin console (/admin)
--
-- WHAT THIS MIGRATION DOES AND WHY EACH PIECE IS NECESSARY
--
-- The admin panel reads production data through a single same-origin Vercel
-- Function (api/admin/[...path].ts) that verifies the caller's Supabase JWT,
-- re-reads `profiles.role` server-side, and only then constructs a
-- service-role Supabase client. Because that client bypasses RLS by design,
-- this migration deliberately does NOT add new admin RLS policies and does
-- NOT widen any existing policy. The browser's permission surface is exactly
-- what it was before /admin existed.
--
-- 1) admin_audit_logs — there was no global record of privileged operations.
--    `activity_logs` is workspace-scoped and customer-visible, so it cannot
--    serve as an operator audit trail. New table, append-only.
--
-- 2) profiles.status — the admin panel is required to suspend an abusive
--    account. No such field existed, and a suspension that only hides a
--    button is not a suspension, so the flag is ENFORCED inside
--    reserve_leads(): a suspended owner's workspaces can no longer consume
--    lead quota (new sentinel -3), which is the gate every search runs
--    through. Only an admin can change it (protect_profile_role trigger).
--
-- 3) Operational indexes — every admin list view sorts by a global
--    timestamp and filters by status. The existing indexes are all
--    workspace-scoped (e.g. leads_ws_idx) and cannot serve those queries.
--
-- 4) admin_* aggregate functions — the dashboards need ~30 counts each. One
--    round trip per count would be unusable, so the aggregation happens in
--    Postgres. These are plain (non-SECURITY DEFINER) functions and EXECUTE
--    is revoked from anon/authenticated: only the service role can call them,
--    i.e. only after the API route has authorized an admin.
--
-- 5) admin_adjust_usage_counter — writes the SAME row reserve_leads() and
--    increment_usage_counter() use (usage_counters), so an operator override
--    can never contradict what the customer sees on /usage.
--
-- Idempotent and safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Account status
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists status text not null default 'active';

alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('active', 'suspended'));

create index if not exists profiles_status_idx on profiles (status) where status <> 'active';
create index if not exists profiles_role_idx on profiles (role) where role = 'admin';
create index if not exists profiles_created_idx on profiles (created_at desc);

-- Role AND status are operator-controlled: a customer must not be able to
-- un-suspend themselves through PostgREST with a crafted PATCH.
create or replace function protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `app.admin_console` is set, transaction-locally, ONLY by the two
  -- SECURITY DEFINER functions below, whose EXECUTE is revoked from anon and
  -- authenticated. It exists because the admin API acts with the service
  -- role, for which auth.uid() is null and is_zybble_admin() is therefore
  -- false — a direct UPDATE would be rejected even though the caller has
  -- already been verified as an admin by the API route. The guard below is
  -- unchanged for every other caller.
  if coalesce(current_setting('app.admin_console', true), '') = 'on' then
    return new;
  end if;
  if new.role is distinct from old.role and not is_zybble_admin() then
    raise exception 'Only an administrator can change profile roles';
  end if;
  if new.status is distinct from old.status and not is_zybble_admin() then
    raise exception 'Only an administrator can change an account status';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1b) The only supported way for the admin API to change role/status.
--
-- Both are SECURITY DEFINER with EXECUTE revoked from anon and authenticated,
-- so they are reachable only by the service role — i.e. only after
-- api/admin/[...path].ts has verified the caller's JWT and read
-- profiles.role = 'admin' for them. Authorization still lives in exactly one
-- place; these functions only carry it across the service-role boundary.
-- ---------------------------------------------------------------------------
drop function if exists admin_set_profile_role(uuid, text);
create function admin_set_profile_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_role not in ('user', 'admin') then
    raise exception 'Invalid role %', p_role;
  end if;
  perform set_config('app.admin_console', 'on', true);
  update profiles set role = p_role where id = p_user
  returning to_jsonb(profiles) - 'phone' into result;
  perform set_config('app.admin_console', '', true);
  return result;
end;
$$;
revoke execute on function admin_set_profile_role(uuid, text) from public, anon, authenticated;

drop function if exists admin_set_profile_status(uuid, text);
create function admin_set_profile_status(p_user uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_status not in ('active', 'suspended') then
    raise exception 'Invalid status %', p_status;
  end if;
  perform set_config('app.admin_console', 'on', true);
  update profiles set status = p_status where id = p_user
  returning to_jsonb(profiles) - 'phone' into result;
  perform set_config('app.admin_console', '', true);
  return result;
end;
$$;
revoke execute on function admin_set_profile_status(uuid, text) from public, anon, authenticated;

drop trigger if exists profiles_protect_role on profiles;
create trigger profiles_protect_role before update on profiles
for each row execute function protect_profile_role();

-- ---------------------------------------------------------------------------
-- 2) Suspension is enforced where quota is consumed.
--
-- Identical to the 0006 definition apart from the suspension gate and the new
-- -3 sentinel, which api/search-run.ts and the search-run Edge Function map
-- to a 403. Keeping the rest byte-for-byte identical matters: this function is
-- the single accounting source for `usage_counters.leads_used`.
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
  owner_status text;
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

  -- A suspended owner suspends the whole workspace. Refunds (delta < 0) are
  -- always allowed so an in-flight search can still unwind its reservation.
  if delta > 0 then
    select pr.status into owner_status
    from workspaces w
    join profiles pr on pr.id = w.owner_id
    where w.id = ws;
    if owner_status = 'suspended' then
      return -3;
    end if;
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
-- 3) Immutable operator audit trail
-- ---------------------------------------------------------------------------
create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users (id) on delete set null,
  admin_email text,
  action text not null,
  target_type text not null,
  target_id text,
  summary text,
  -- `before`/`after` capture old value → new value for every mutation.
  -- Never store credentials, tokens, or provider secrets here.
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx on admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_admin_idx on admin_audit_logs (admin_user_id, created_at desc);
create index if not exists admin_audit_logs_action_idx on admin_audit_logs (action, created_at desc);
create index if not exists admin_audit_logs_target_idx on admin_audit_logs (target_type, target_id);

alter table admin_audit_logs enable row level security;

-- Readable by admins (so the audit page keeps working even if a future
-- surface reads it directly); never writable, updatable, or deletable through
-- PostgREST by anyone. Rows are inserted exclusively by the service-role
-- client inside api/admin, which bypasses RLS. The absence of INSERT/UPDATE/
-- DELETE policies is what makes the log immutable from the admin UI.
drop policy if exists "admin audit read" on admin_audit_logs;
create policy "admin audit read" on admin_audit_logs
for select using (is_zybble_admin());

revoke insert, update, delete on admin_audit_logs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Indexes for the global (non workspace-scoped) operator queries.
--    Every existing index is keyed on workspace_id first and cannot serve a
--    "most recent across the whole platform, filtered by status" scan.
-- ---------------------------------------------------------------------------
create index if not exists workspaces_created_idx on workspaces (created_at desc);
create index if not exists workspaces_plan_idx on workspaces (plan_id);

create index if not exists subscriptions_status_idx on subscriptions (status, updated_at desc);
create index if not exists subscriptions_plan_idx on subscriptions (plan_id);
create index if not exists subscriptions_period_end_idx on subscriptions (current_period_end)
  where current_period_end is not null;
create index if not exists subscriptions_rzp_idx on subscriptions (razorpay_subscription_id)
  where razorpay_subscription_id is not null;

create index if not exists payments_created_idx on payments (created_at desc);
create index if not exists payments_status_idx on payments (status, created_at desc);
create index if not exists payments_rzp_sub_idx on payments (razorpay_subscription_id)
  where razorpay_subscription_id is not null;

create index if not exists invoices_issued_idx on invoices (issued_at desc);
create index if not exists invoices_status_idx on invoices (status, issued_at desc);

create index if not exists subscription_events_created_idx on subscription_events (created_at desc);
create index if not exists subscription_events_type_idx on subscription_events (event_type, created_at desc);
create index if not exists subscription_checkouts_created_idx on subscription_checkouts (created_at desc);

create index if not exists lead_searches_created_idx on lead_searches (created_at desc);
create index if not exists lead_searches_status_idx on lead_searches (status, created_at desc);
create index if not exists lead_searches_user_idx on lead_searches (user_id, created_at desc);

create index if not exists lead_search_jobs_status_idx on lead_search_jobs (status, created_at desc);
create index if not exists lead_search_jobs_ws_idx on lead_search_jobs (workspace_id, created_at desc);

create index if not exists leads_created_idx on leads (created_at desc);
create index if not exists leads_source_idx on leads (source);
create index if not exists leads_status_global_idx on leads (status);

create index if not exists lead_lists_owner_idx on lead_lists (owner_id);

create index if not exists exports_created_idx on exports (created_at desc);
create index if not exists exports_status_idx on exports (status, created_at desc);
create index if not exists exports_user_idx on exports (user_id, created_at desc);

create index if not exists ai_requests_created_idx on ai_requests (created_at desc);
create index if not exists ai_requests_status_idx on ai_requests (status, created_at desc);
create index if not exists ai_requests_ws_idx on ai_requests (workspace_id, created_at desc);
create index if not exists ai_requests_user_idx on ai_requests (user_id, created_at desc);

create index if not exists activity_logs_created_idx on activity_logs (created_at desc);
create index if not exists activity_logs_actor_idx on activity_logs (actor_id, created_at desc);

create index if not exists webhook_events_received_idx on webhook_events (received_at desc);
create index if not exists webhook_events_status_idx on webhook_events (status, received_at desc);
create index if not exists webhook_events_event_id_idx on webhook_events (event_id);

create index if not exists usage_counters_period_idx on usage_counters (period_start desc);

-- ---------------------------------------------------------------------------
-- 5) Operator aggregates.
--
-- Non-SECURITY-DEFINER on purpose: they must run with the privileges of the
-- caller, and the only caller is the service-role client created AFTER
-- api/admin has verified profiles.role = 'admin'. EXECUTE is revoked from
-- anon and authenticated so a signed-in customer cannot call them via
-- PostgREST RPC.
-- ---------------------------------------------------------------------------

drop function if exists admin_overview_metrics(timestamptz, timestamptz);
create function admin_overview_metrics(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  with
  period as (select p_from as f, p_to as t),
  today as (select date_trunc('day', now()) as d),
  month_start as (select date_trunc('month', now())::date as d)
  select jsonb_build_object(
    'customers', jsonb_build_object(
      'total',       (select count(*) from profiles),
      'new',         (select count(*) from profiles, period where created_at >= f and created_at < t),
      'suspended',   (select count(*) from profiles where status = 'suspended'),
      'admins',      (select count(*) from profiles where role = 'admin'),
      -- "Active" = produced a search, export or AI request in the window.
      -- Derived from real activity, not from a last_seen column (none exists).
      'active',      (
        select count(distinct u) from (
          select user_id as u from lead_searches, period where created_at >= f and created_at < t
          union
          select user_id from exports, period where created_at >= f and created_at < t
          union
          select user_id from ai_requests, period where created_at >= f and created_at < t and user_id is not null
        ) s
      ),
      'by_plan',     (
        select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb) from (
          select effective_plan_for_user(p.id) as plan, count(*) as n
          from profiles p group by 1
        ) q
      )
    ),
    'business', jsonb_build_object(
      'paid_active',    (select count(*) from subscriptions
                         where status in ('active','trialing') and plan_id <> 'free'),
      'by_status',      (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                         from (select status, count(*) n from subscriptions group by 1) q),
      'by_plan',        (select coalesce(jsonb_object_agg(plan_id, n), '{}'::jsonb)
                         from (select plan_id, count(*) n from subscriptions
                               where status in ('active','trialing') group by 1) q),
      -- Monthly recurring revenue in the smallest currency unit (paise).
      -- Safe to compute: every plan in `plans` is billed monthly and
      -- price_cents is the authoritative monthly amount.
      'mrr_minor',      (select coalesce(sum(pl.price_cents), 0) from subscriptions s
                         join plans pl on pl.id = s.plan_id
                         where s.status in ('active','trialing')),
      'currency',       (select coalesce(max(currency), 'INR') from plans),
      'payments_count', (select count(*) from payments, period where created_at >= f and created_at < t),
      'payments_minor', (select coalesce(sum(amount_cents), 0) from payments, period
                         where created_at >= f and created_at < t and status = 'captured'),
      'failed_payments',(select count(*) from payments, period
                         where created_at >= f and created_at < t and status = 'failed'),
      'refunds',        (select count(*) from invoices, period
                         where issued_at >= f and issued_at < t and status = 'refunded'),
      'cancellations',  (select count(*) from subscriptions, period
                         where updated_at >= f and updated_at < t and status in ('cancelled','expired')),
      'pending_cancel', (select count(*) from subscriptions where cancel_at_cycle_end),
      'renewals_30d',   (select count(*) from subscriptions
                         where status in ('active','trialing')
                           and current_period_end between now() and now() + interval '30 days')
    ),
    'product', jsonb_build_object(
      'searches_today',  (select count(*) from lead_searches, today where created_at >= d),
      'searches_7d',     (select count(*) from lead_searches where created_at >= now() - interval '7 days'),
      'searches_30d',    (select count(*) from lead_searches where created_at >= now() - interval '30 days'),
      'searches_period', (select count(*) from lead_searches, period where created_at >= f and created_at < t),
      'leads_total',     (select count(*) from leads),
      'leads_period',    (select count(*) from leads, period where created_at >= f and created_at < t),
      'lists_total',     (select count(*) from lead_lists),
      'exports_period',  (select count(*) from exports, period where created_at >= f and created_at < t),
      'workspaces',      (select count(*) from workspaces),
      'client_workspaces',(select count(*) from workspaces where is_client),
      'active_workspaces',(select count(distinct workspace_id) from lead_searches, period
                           where created_at >= f and created_at < t)
    ),
    'operations', jsonb_build_object(
      'failed_searches', (select count(*) from lead_searches, period
                          where created_at >= f and created_at < t and status = 'failed'),
      'partial_searches',(select count(*) from lead_searches, period
                          where created_at >= f and created_at < t and status = 'partial'),
      'running_jobs',    (select count(*) from lead_search_jobs
                          where status in ('queued','processing','fetching','normalizing','deduplicating','saving')),
      'failed_exports',  (select count(*) from exports, period
                          where created_at >= f and created_at < t and status = 'failed'),
      'ai_requests',     (select count(*) from ai_requests, period where created_at >= f and created_at < t),
      'failed_ai',       (select count(*) from ai_requests, period
                          where created_at >= f and created_at < t and status = 'failed'),
      'webhooks',        (select count(*) from webhook_events, period
                          where received_at >= f and received_at < t),
      'failed_webhooks', (select count(*) from webhook_events, period
                          where received_at >= f and received_at < t and status = 'failed'),
      'unprocessed_webhooks', (select count(*) from webhook_events where status = 'received'),
      'exhausted_workspaces', (
        select count(*) from usage_counters u, month_start m
        join workspaces w on w.id = u.workspace_id
        join plans pl on pl.id = workspace_plan(w.id)
        where u.period_start = m.d and pl.lead_allowance > 0 and u.leads_used >= pl.lead_allowance
      )
    )
  );
$$;
revoke execute on function admin_overview_metrics(timestamptz, timestamptz) from public, anon, authenticated;

drop function if exists admin_leads_overview(timestamptz, timestamptz);
create function admin_leads_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'total',            (select count(*) from leads),
    'period',           (select count(*) from leads where created_at >= p_from and created_at < p_to),
    'with_email',       (select count(*) from leads where email is not null and email <> ''),
    'with_phone',       (select count(*) from leads where phone is not null and phone <> ''),
    'with_website',     (select count(*) from leads where website is not null and website <> ''),
    'by_status',        (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                         from (select status, count(*) n from leads group by 1) q),
    'by_source',        (select coalesce(jsonb_object_agg(coalesce(source, 'unknown'), n), '{}'::jsonb)
                         from (select source, count(*) n from leads group by 1 order by 2 desc limit 12) q),
    'by_provider',      (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb)
                         from (select provider, count(*) n from leads group by 1 order by 2 desc limit 12) q),
    'by_business_size', (select coalesce(jsonb_object_agg(business_size, n), '{}'::jsonb)
                         from (select business_size, count(*) n from leads group by 1) q),
    -- `leads` is uniquely keyed on (workspace_id, dedupe_key), so duplicates
    -- can only exist ACROSS workspaces. That cross-workspace overlap is the
    -- only duplicate figure this schema can honestly report.
    'cross_workspace_duplicates', (
      select count(*) from (
        select dedupe_key from leads group by dedupe_key having count(*) > 1
      ) d
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'count', n) order by day), '[]'::jsonb)
      from (
        select date_trunc('day', created_at)::date as day, count(*) as n
        from leads where created_at >= p_from and created_at < p_to
        group by 1
      ) q
    )
  );
$$;
revoke execute on function admin_leads_overview(timestamptz, timestamptz) from public, anon, authenticated;

drop function if exists admin_usage_overview(date);
create function admin_usage_overview(p_period date)
returns table (
  workspace_id uuid,
  workspace_name text,
  owner_id uuid,
  owner_name text,
  owner_email text,
  plan_id text,
  lead_allowance integer,
  leads_used integer,
  searches integer,
  exports integer,
  ai_runs integer,
  pct numeric,
  updated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    w.id,
    w.name,
    w.owner_id,
    coalesce(pr.name, ''),
    coalesce(au.email, ''),
    workspace_plan(w.id),
    pl.lead_allowance,
    coalesce(u.leads_used, 0),
    coalesce(u.searches, 0),
    coalesce(u.exports, 0),
    coalesce(u.ai_runs, 0),
    case when pl.lead_allowance > 0
      then round((coalesce(u.leads_used, 0)::numeric / pl.lead_allowance) * 100, 1)
      else 0 end,
    u.updated_at
  from workspaces w
  left join profiles pr on pr.id = w.owner_id
  left join auth.users au on au.id = w.owner_id
  join plans pl on pl.id = workspace_plan(w.id)
  left join usage_counters u on u.workspace_id = w.id and u.period_start = p_period;
$$;
-- SECURITY DEFINER: reads auth.users, which only the function owner is
-- guaranteed to hold privileges on. EXECUTE is revoked below so the only
-- possible caller is the authorized admin API's service-role client.
alter function admin_usage_overview(date) security definer;
revoke execute on function admin_usage_overview(date) from public, anon, authenticated;

drop function if exists admin_ai_overview(timestamptz, timestamptz);
create function admin_ai_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'total',     (select count(*) from ai_requests where created_at >= p_from and created_at < p_to),
    'completed', (select count(*) from ai_requests where created_at >= p_from and created_at < p_to and status = 'completed'),
    'failed',    (select count(*) from ai_requests where created_at >= p_from and created_at < p_to and status = 'failed'),
    'processing',(select count(*) from ai_requests where status = 'processing'),
    'by_kind',   (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
                  from (select kind, count(*) n from ai_requests
                        where created_at >= p_from and created_at < p_to group by 1) q),
    'by_model',  (select coalesce(jsonb_object_agg(coalesce(model, 'unspecified'), n), '{}'::jsonb)
                  from (select model, count(*) n from ai_requests
                        where created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 12) q),
    -- `tokens` is nullable and is only written by surfaces that receive a
    -- usage block from OpenRouter. Reported alongside the count of rows that
    -- actually carry a value so the UI can say how complete the figure is.
    'tokens_sum',    (select coalesce(sum(tokens), 0) from ai_requests
                      where created_at >= p_from and created_at < p_to and tokens is not null),
    'tokens_rows',   (select count(*) from ai_requests
                      where created_at >= p_from and created_at < p_to and tokens is not null),
    'top_errors', (
      select coalesce(jsonb_agg(jsonb_build_object('error', e, 'count', n) order by n desc), '[]'::jsonb)
      from (select left(error, 120) as e, count(*) n from ai_requests
            where created_at >= p_from and created_at < p_to and error is not null and error <> ''
            group by 1 order by 2 desc limit 10) q
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'total', n, 'failed', f) order by day), '[]'::jsonb)
      from (
        select date_trunc('day', created_at)::date as day,
               count(*) as n,
               count(*) filter (where status = 'failed') as f
        from ai_requests where created_at >= p_from and created_at < p_to group by 1
      ) q
    ),
    'top_workspaces', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', nm, 'count', n) order by n desc), '[]'::jsonb)
      from (
        select w.id, w.name as nm, count(*) as n
        from ai_requests a join workspaces w on w.id = a.workspace_id
        where a.created_at >= p_from and a.created_at < p_to
        group by 1, 2 order by 3 desc limit 10
      ) q
    )
  );
$$;
revoke execute on function admin_ai_overview(timestamptz, timestamptz) from public, anon, authenticated;

drop function if exists admin_system_health(integer);
create function admin_system_health(p_window_minutes integer default 60)
returns jsonb
language sql
stable
set search_path = public
as $$
  with w as (select now() - make_interval(mins => greatest(1, p_window_minutes)) as since)
  select jsonb_build_object(
    'window_minutes', greatest(1, p_window_minutes),
    'searches',  jsonb_build_object(
      'total',  (select count(*) from lead_searches, w where created_at >= since),
      'failed', (select count(*) from lead_searches, w where created_at >= since and status = 'failed'),
      'stuck',  (select count(*) from lead_search_jobs
                 where status in ('queued','processing','fetching','normalizing','deduplicating','saving')
                   and created_at < now() - interval '15 minutes')
    ),
    'exports',   jsonb_build_object(
      'total',  (select count(*) from exports, w where created_at >= since),
      'failed', (select count(*) from exports, w where created_at >= since and status = 'failed'),
      'stuck',  (select count(*) from exports
                 where status in ('preparing','processing') and created_at < now() - interval '15 minutes')
    ),
    'ai',        jsonb_build_object(
      'total',  (select count(*) from ai_requests, w where created_at >= since),
      'failed', (select count(*) from ai_requests, w where created_at >= since and status = 'failed')
    ),
    'webhooks',  jsonb_build_object(
      'total',       (select count(*) from webhook_events, w where received_at >= since),
      'failed',      (select count(*) from webhook_events, w where received_at >= since and status = 'failed'),
      'unprocessed', (select count(*) from webhook_events
                      where status = 'received' and received_at < now() - interval '10 minutes'),
      'last_at',     (select max(received_at) from webhook_events)
    ),
    'payments',  jsonb_build_object(
      'total',  (select count(*) from payments, w where created_at >= since),
      'failed', (select count(*) from payments, w where created_at >= since and status = 'failed')
    ),
    'recent_search_errors', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'at', created_at, 'workspace_id', workspace_id, 'error', left(error, 200)
      ) order by created_at desc), '[]'::jsonb)
      from (select id, created_at, workspace_id, error from lead_searches
            where status = 'failed' and error is not null
            order by created_at desc limit 10) q
    ),
    'recent_webhook_errors', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'at', received_at, 'event_type', event_type, 'error', left(error, 200)
      ) order by received_at desc), '[]'::jsonb)
      from (select id, received_at, event_type, error from webhook_events
            where status = 'failed' order by received_at desc limit 10) q
    )
  );
$$;
revoke execute on function admin_system_health(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Quota override.
--
-- Writes usage_counters directly — the SAME row reserve_leads() reserves from
-- and the customer's /usage page reads — so an override can never produce a
-- number that contradicts the product. Clamped to >= 0; the caller
-- (api/admin) is responsible for the audit log entry and returns the old and
-- new values so the operator sees exactly what changed.
-- ---------------------------------------------------------------------------
drop function if exists admin_adjust_usage_counter(uuid, date, text, integer);
create function admin_adjust_usage_counter(
  ws uuid,
  p_period date,
  p_metric text,
  p_value integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  old_value integer;
  new_value integer := greatest(0, p_value);
begin
  if p_metric not in ('leads_used', 'searches', 'exports', 'ai_runs') then
    raise exception 'invalid_usage_metric';
  end if;
  if not exists (select 1 from workspaces where id = ws) then
    raise exception 'workspace_not_found';
  end if;

  insert into usage_counters (workspace_id, period_start)
  values (ws, p_period)
  on conflict (workspace_id, period_start) do nothing;

  -- Capture the prior value first so the audit log can record old → new.
  select case p_metric
    when 'leads_used' then leads_used
    when 'searches' then searches
    when 'exports' then exports
    else ai_runs end
  into old_value
  from usage_counters where workspace_id = ws and period_start = p_period;

  -- `p_metric` is validated against a fixed allow-list above, so this
  -- format()/%I cannot be used for SQL injection.
  execute format(
    'update usage_counters set %I = $1, updated_at = now() where workspace_id = $2 and period_start = $3',
    p_metric
  ) using new_value, ws, p_period;

  return jsonb_build_object(
    'workspace_id', ws,
    'period_start', p_period,
    'metric', p_metric,
    'old_value', coalesce(old_value, 0),
    'value', new_value
  );
end;
$$;
revoke execute on function admin_adjust_usage_counter(uuid, date, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) Customer + workspace operator queries.
--
-- These exist as SQL rather than as PostgREST calls for two reasons:
--
--  a) Email lives in `auth.users`, which is not an exposed PostgREST schema.
--     Resolving it per row from the API would be an N+1 of auth admin calls.
--  b) "Effective plan", "workspace count" and "current usage" each need a
--     correlated subquery. Doing them in Postgres keeps every admin list to a
--     single round trip with real server-side filtering, sorting and paging.
--
-- SECURITY DEFINER because of auth.users; EXECUTE revoked from anon and
-- authenticated so only the authorized admin API can reach them.
-- ---------------------------------------------------------------------------
drop function if exists admin_lookup_identities(uuid[]);
create function admin_lookup_identities(p_ids uuid[])
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, coalesce(p.name, ''), coalesce(au.email, '')
  from profiles p
  left join auth.users au on au.id = p.id
  where p.id = any(p_ids);
$$;
revoke execute on function admin_lookup_identities(uuid[]) from public, anon, authenticated;

drop function if exists admin_list_users(text, text, text, text, text, timestamptz, timestamptz, text, text, integer, integer);
create function admin_list_users(
  p_search text default '',
  p_plan text default '',
  p_role text default '',
  p_status text default '',
  p_sub_status text default '',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sort text default 'created_at',
  p_dir text default 'desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  email text,
  role text,
  status text,
  created_at timestamptz,
  plan_id text,
  subscription_status text,
  subscription_id text,
  workspace_count integer,
  leads_used integer,
  searches integer,
  last_activity_at timestamptz,
  total_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  with base as (
    select
      p.id,
      p.name,
      coalesce(au.email, '') as email,
      p.role,
      p.status,
      p.created_at,
      effective_plan_for_user(p.id) as plan_id,
      s.status as subscription_status,
      s.razorpay_subscription_id as subscription_id,
      (select count(*)::int from workspaces w where w.owner_id = p.id) as workspace_count,
      coalesce((
        select sum(u.leads_used)::int from usage_counters u
        join workspaces w on w.id = u.workspace_id
        where w.owner_id = p.id and u.period_start = date_trunc('month', now())::date
      ), 0) as leads_used,
      coalesce((
        select sum(u.searches)::int from usage_counters u
        join workspaces w on w.id = u.workspace_id
        where w.owner_id = p.id and u.period_start = date_trunc('month', now())::date
      ), 0) as searches,
      greatest(
        (select max(ls.created_at) from lead_searches ls where ls.user_id = p.id),
        (select max(e.created_at) from exports e where e.user_id = p.id)
      ) as last_activity_at
    from profiles p
    left join auth.users au on au.id = p.id
    left join subscriptions s on s.user_id = p.id
  ),
  filtered as (
    select * from base
    where (p_search = '' or name ilike '%' || p_search || '%' or email ilike '%' || p_search || '%'
           or id::text = p_search)
      and (p_plan = '' or plan_id = p_plan)
      and (p_role = '' or role = p_role)
      and (p_status = '' or status = p_status)
      and (p_sub_status = '' or coalesce(subscription_status, 'none') = p_sub_status)
      and (p_from is null or created_at >= p_from)
      and (p_to is null or created_at < p_to)
  )
  select f.*, (select count(*) from filtered) as total_count
  from filtered f
  order by
    case when p_dir = 'asc' then
      case p_sort when 'name' then f.name when 'email' then f.email when 'plan' then f.plan_id else null end
    end asc nulls last,
    case when p_dir <> 'asc' then
      case p_sort when 'name' then f.name when 'email' then f.email when 'plan' then f.plan_id else null end
    end desc nulls last,
    case when p_sort = 'leads_used' and p_dir = 'asc' then f.leads_used end asc nulls last,
    case when p_sort = 'leads_used' and p_dir <> 'asc' then f.leads_used end desc nulls last,
    case when p_sort = 'created_at' and p_dir = 'asc' then f.created_at end asc nulls last,
    case when p_sort = 'created_at' and p_dir <> 'asc' then f.created_at end desc nulls last,
    f.created_at desc
  limit greatest(1, least(100, p_limit))
  offset greatest(0, p_offset);
$$;
revoke execute on function admin_list_users(text, text, text, text, text, timestamptz, timestamptz, text, text, integer, integer)
  from public, anon, authenticated;

drop function if exists admin_user_detail(uuid);
create function admin_user_detail(p_user uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case when not exists (select 1 from profiles where id = p_user) then null else jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'name', p.name, 'avatar_url', p.avatar_url, 'role', p.role,
        'status', p.status, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'email', coalesce(au.email, ''),
        'email_confirmed_at', au.email_confirmed_at,
        'last_sign_in_at', au.last_sign_in_at,
        'effective_plan', effective_plan_for_user(p.id)
      )
      from profiles p left join auth.users au on au.id = p.id where p.id = p_user
    ),
    'subscription', (
      select to_jsonb(s) - 'razorpay_customer_id' from subscriptions s where s.user_id = p_user
    ),
    'checkouts', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
      from (select * from subscription_checkouts where user_id = p_user order by created_at desc limit 5) c
    ),
    'payments', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, razorpay_payment_id, razorpay_subscription_id, amount_cents, currency,
                   status, method, captured_at, created_at
            from payments where user_id = p_user order by created_at desc limit 20) x
    ),
    'invoices', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.issued_at desc), '[]'::jsonb)
      from (select id, number, description, amount_cents, currency, status,
                   razorpay_invoice_id, razorpay_payment_id, period_start, period_end, issued_at
            from invoices where user_id = p_user order by issued_at desc limit 20) x
    ),
    'workspaces', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'is_client', w.is_client, 'created_at', w.created_at,
        'is_owner', w.owner_id = p_user,
        'member_role', (select m2.role from workspace_members m2 where m2.workspace_id = w.id and m2.user_id = p_user),
        'plan_id', workspace_plan(w.id),
        'member_count', (select count(*)::int from workspace_members m3 where m3.workspace_id = w.id),
        'leads_used', coalesce((select u.leads_used from usage_counters u
                                where u.workspace_id = w.id
                                  and u.period_start = date_trunc('month', now())::date), 0),
        'lead_allowance', (select pl.lead_allowance from plans pl where pl.id = workspace_plan(w.id))
      ) order by w.created_at), '[]'::jsonb)
      from workspaces w
      where w.owner_id = p_user
         or exists (select 1 from workspace_members m where m.workspace_id = w.id and m.user_id = p_user)
    ),
    'usage', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'period_start', u.period_start,
        'leads_used', sum(u.leads_used), 'searches', sum(u.searches),
        'exports', sum(u.exports), 'ai_runs', sum(u.ai_runs)
      ) order by u.period_start desc), '[]'::jsonb)
      from usage_counters u
      join workspaces w on w.id = u.workspace_id
      where w.owner_id = p_user
      group by u.period_start
    ),
    'searches', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, workspace_id, query, location, requested_count, result_count,
                   status, error, created_at, completed_at
            from lead_searches where user_id = p_user order by created_at desc limit 15) x
    ),
    'exports', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, workspace_id, file_name, source, lead_count, status, error, created_at, completed_at
            from exports where user_id = p_user order by created_at desc limit 10) x
    ),
    'ai_requests', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, workspace_id, kind, status, model, tokens, error, created_at
            from ai_requests where user_id = p_user order by created_at desc limit 15) x
    ),
    'activity', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, workspace_id, kind, text, created_at
            from activity_logs where actor_id = p_user order by created_at desc limit 20) x
    ),
    'sessions', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen_at desc), '[]'::jsonb)
      from (select id, user_agent, created_at, last_seen_at, revoked_at
            from app_sessions where user_id = p_user order by last_seen_at desc limit 10) x
    ),
    'admin_actions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'admin_email', a.admin_email,
        'summary', a.summary, 'before', a.before, 'after', a.after, 'created_at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from (select * from admin_audit_logs
            where target_type = 'user' and target_id = p_user::text
            order by created_at desc limit 20) a
    )
  ) end;
$$;
revoke execute on function admin_user_detail(uuid) from public, anon, authenticated;

drop function if exists admin_list_workspaces(text, text, text, text, integer, integer);
create function admin_list_workspaces(
  p_search text default '',
  p_plan text default '',
  p_client text default '',
  p_sort text default 'created_at',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  owner_id uuid,
  owner_name text,
  owner_email text,
  plan_id text,
  is_client boolean,
  created_at timestamptz,
  member_count integer,
  lead_count integer,
  list_count integer,
  leads_used integer,
  searches integer,
  lead_allowance integer,
  last_search_at timestamptz,
  total_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  with base as (
    select
      w.id, w.name, w.owner_id,
      coalesce(pr.name, '') as owner_name,
      coalesce(au.email, '') as owner_email,
      workspace_plan(w.id) as plan_id,
      w.is_client, w.created_at,
      (select count(*)::int from workspace_members m where m.workspace_id = w.id) as member_count,
      (select count(*)::int from leads l where l.workspace_id = w.id) as lead_count,
      (select count(*)::int from lead_lists ll where ll.workspace_id = w.id) as list_count,
      coalesce(u.leads_used, 0) as leads_used,
      coalesce(u.searches, 0) as searches,
      (select pl.lead_allowance from plans pl where pl.id = workspace_plan(w.id)) as lead_allowance,
      (select max(ls.created_at) from lead_searches ls where ls.workspace_id = w.id) as last_search_at
    from workspaces w
    left join profiles pr on pr.id = w.owner_id
    left join auth.users au on au.id = w.owner_id
    left join usage_counters u on u.workspace_id = w.id
      and u.period_start = date_trunc('month', now())::date
  ),
  filtered as (
    select * from base
    where (p_search = '' or name ilike '%' || p_search || '%'
           or owner_name ilike '%' || p_search || '%'
           or owner_email ilike '%' || p_search || '%'
           or id::text = p_search)
      and (p_plan = '' or plan_id = p_plan)
      and (p_client = '' or (p_client = 'client') = is_client)
  )
  select f.*, (select count(*) from filtered) as total_count
  from filtered f
  order by
    case when p_sort = 'name' then f.name end asc nulls last,
    case when p_sort = 'leads' then f.lead_count end desc nulls last,
    case when p_sort = 'usage' then f.leads_used end desc nulls last,
    case when p_sort = 'activity' then f.last_search_at end desc nulls last,
    case when p_sort = 'members' then f.member_count end desc nulls last,
    f.created_at desc
  limit greatest(1, least(100, p_limit))
  offset greatest(0, p_offset);
$$;
revoke execute on function admin_list_workspaces(text, text, text, text, integer, integer)
  from public, anon, authenticated;

drop function if exists admin_workspace_detail(uuid);
create function admin_workspace_detail(p_ws uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case when not exists (select 1 from workspaces where id = p_ws) then null else jsonb_build_object(
    'workspace', (
      select jsonb_build_object(
        'id', w.id, 'name', w.name, 'is_client', w.is_client, 'created_at', w.created_at,
        'stored_plan_id', w.plan_id,
        'plan_id', workspace_plan(w.id),
        'owner', jsonb_build_object(
          'id', w.owner_id, 'name', coalesce(pr.name, ''), 'email', coalesce(au.email, ''),
          'role', coalesce(pr.role, 'user'), 'status', coalesce(pr.status, 'active')
        ),
        'plan', (select to_jsonb(pl) from plans pl where pl.id = workspace_plan(w.id))
      )
      from workspaces w
      left join profiles pr on pr.id = w.owner_id
      left join auth.users au on au.id = w.owner_id
      where w.id = p_ws
    ),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'role', m.role, 'created_at', m.created_at,
        'name', coalesce(pr.name, ''), 'email', coalesce(au.email, ''),
        'account_status', coalesce(pr.status, 'active')
      ) order by m.created_at), '[]'::jsonb)
      from workspace_members m
      left join profiles pr on pr.id = m.user_id
      left join auth.users au on au.id = m.user_id
      where m.workspace_id = p_ws
    ),
    'invitations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'status', i.status, 'created_at', i.created_at
      ) order by i.created_at desc), '[]'::jsonb)
      from workspace_invitations i where i.workspace_id = p_ws
    ),
    'usage', (
      select coalesce(jsonb_agg(to_jsonb(u) order by u.period_start desc), '[]'::jsonb)
      from (select * from usage_counters where workspace_id = p_ws
            order by period_start desc limit 12) u
    ),
    'searches', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, user_id, query, location, requested_count, result_count,
                   status, error, created_at, completed_at
            from lead_searches where workspace_id = p_ws order by created_at desc limit 20) x
    ),
    'jobs', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, search_id, status, requested_count, processed_count,
                   current_stage, error, started_at, completed_at, created_at
            from lead_search_jobs where workspace_id = p_ws order by created_at desc limit 20) x
    ),
    'leads', jsonb_build_object(
      'total',        (select count(*) from leads where workspace_id = p_ws),
      'with_email',   (select count(*) from leads where workspace_id = p_ws and email is not null and email <> ''),
      'with_phone',   (select count(*) from leads where workspace_id = p_ws and phone is not null and phone <> ''),
      'with_website', (select count(*) from leads where workspace_id = p_ws and website is not null and website <> ''),
      'by_status',    (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                       from (select status, count(*) n from leads where workspace_id = p_ws group by 1) q),
      'by_source',    (select coalesce(jsonb_object_agg(coalesce(source, 'unknown'), n), '{}'::jsonb)
                       from (select source, count(*) n from leads where workspace_id = p_ws
                             group by 1 order by 2 desc limit 8) q),
      'by_provider',  (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb)
                       from (select provider, count(*) n from leads where workspace_id = p_ws group by 1) q)
    ),
    'lists', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'name', l.name, 'created_at', l.created_at,
        'size', (select count(*) from lead_list_members lm where lm.list_id = l.id)
      ) order by l.created_at desc), '[]'::jsonb)
      from (select * from lead_lists where workspace_id = p_ws order by created_at desc limit 20) l
    ),
    'exports', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, user_id, file_name, source, lead_count, status, error, created_at, completed_at
            from exports where workspace_id = p_ws order by created_at desc limit 15) x
    ),
    'ai_requests', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, user_id, kind, status, model, tokens, error, created_at
            from ai_requests where workspace_id = p_ws order by created_at desc limit 15) x
    ),
    'activity', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, actor_id, kind, text, created_at
            from activity_logs where workspace_id = p_ws order by created_at desc limit 25) x
    )
  ) end;
$$;
revoke execute on function admin_workspace_detail(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) PostgREST must re-read the schema so the new RPCs/columns are visible.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
