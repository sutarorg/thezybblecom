-- ============================================================================
-- Zybble — 0008: the admin operations console (/admin).
--
-- WHY THIS MIGRATION EXISTS
--
-- The product already had an admin ROLE (`profiles.role = 'admin'`) and a
-- non-recursive predicate (`is_zybble_admin()`), plus a handful of
-- "admin read" SELECT policies added in 0001. That is NOT a complete
-- permission chain for an operations console:
--
--   * Admin SELECT policies exist only for workspaces, workspace_members,
--     subscriptions, leads, lead_searches, usage_counters, webhook_events and
--     profiles. There is NO admin read path for payments, invoices, exports,
--     ai_requests, activity_logs, lead_lists, lead_search_jobs, lead_notes,
--     app_sessions or subscription_checkouts.
--   * `auth.users` (email, last sign-in, ban state) is not reachable from
--     PostgREST at all, so a browser client can never answer "who is this
--     customer and when did they last sign in".
--   * Cross-tenant AGGREGATES (global revenue, global usage, failure rates)
--     cannot be computed from row-level reads without shipping whole tables
--     to the browser.
--   * Privileged mutations (role changes, quota overrides, plan entitlement
--     edits, provider reconciliation) must never be reachable from a browser
--     session, however the UI is manipulated.
--
-- The deliberate decision is therefore: **the admin console does not widen
-- RLS at all**. Not a single existing policy is relaxed here. Instead:
--
--   1. The browser calls same-origin `/api/admin/*` with its Supabase JWT.
--   2. The Vercel function verifies the JWT, then verifies
--      `profiles.role = 'admin'` server-side with a privileged client.
--   3. Only after that does it read through the functions below, which are
--      SECURITY DEFINER and **granted to `service_role` only** — revoked from
--      `anon` and `authenticated`, so a signed-in customer (or a forged
--      request with a stolen anon key) cannot call them even by name.
--   4. Every privileged mutation writes an immutable `admin_audit_logs` row.
--
-- Also added: the indexes the operational queries need, so the console never
-- degrades into sequential scans on leads / lead_searches / payments /
-- ai_requests / webhook_events / activity_logs.
--
-- Idempotent and safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Immutable admin audit trail
-- ---------------------------------------------------------------------------
-- `activity_logs` is workspace-scoped, customer-visible product history. An
-- administrative action against ANOTHER person's account belongs in a
-- separate, admin-only, append-only table.
--
-- actor identity is denormalized (admin_email / admin_name) on purpose: an
-- audit record must stay readable after the acting admin's profile is renamed
-- or their auth user is deleted.
create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users (id) on delete set null,
  admin_email text,
  admin_name text,
  action text not null,
  target_type text not null,
  target_id text,
  target_label text,
  summary text not null default '',
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  result text not null default 'success' check (result in ('success', 'failure')),
  error text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx on admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_admin_idx on admin_audit_logs (admin_user_id, created_at desc);
create index if not exists admin_audit_logs_action_idx on admin_audit_logs (action, created_at desc);
create index if not exists admin_audit_logs_target_idx on admin_audit_logs (target_type, target_id, created_at desc);

alter table admin_audit_logs enable row level security;

-- No policy grants INSERT/UPDATE/DELETE to any browser role. Reads are
-- restricted to administrators; everything else goes through the privileged
-- server client, which bypasses RLS by design.
drop policy if exists "admin audit read" on admin_audit_logs;
create policy "admin audit read" on admin_audit_logs
for select using (is_zybble_admin());

-- Append-only, enforced in the database — not merely "the UI has no button".
-- This fires for the service role too, so a compromised server key still
-- cannot quietly rewrite history.
create or replace function admin_audit_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_logs is append-only';
end;
$$;

drop trigger if exists admin_audit_logs_no_update on admin_audit_logs;
create trigger admin_audit_logs_no_update before update on admin_audit_logs
for each row execute function admin_audit_logs_immutable();

drop trigger if exists admin_audit_logs_no_delete on admin_audit_logs;
create trigger admin_audit_logs_no_delete before delete on admin_audit_logs
for each row execute function admin_audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- 2) Indexes for the operational queries
--
-- Every index below backs a filter/sort the console actually issues. Nothing
-- speculative: the admin lists are ordered by recency and filtered by status,
-- and the aggregates bucket by created_at.
-- ---------------------------------------------------------------------------
create index if not exists profiles_created_idx on profiles (created_at desc);
create index if not exists profiles_role_idx on profiles (role) where role = 'admin';

create index if not exists workspaces_created_idx on workspaces (created_at desc);
create index if not exists workspaces_plan_idx on workspaces (plan_id);

create index if not exists subscriptions_status_idx on subscriptions (status, updated_at desc);
create index if not exists subscriptions_plan_idx on subscriptions (plan_id);
create index if not exists subscriptions_renewal_idx on subscriptions (current_period_end);
create index if not exists subscriptions_rzp_sub_idx on subscriptions (razorpay_subscription_id);

create index if not exists payments_created_idx on payments (created_at desc);
create index if not exists payments_status_idx on payments (status, created_at desc);
create index if not exists payments_rzp_sub_idx on payments (razorpay_subscription_id);

create index if not exists invoices_issued_idx on invoices (issued_at desc);
create index if not exists invoices_status_idx on invoices (status, issued_at desc);

create index if not exists lead_searches_created_idx on lead_searches (created_at desc);
create index if not exists lead_searches_status_idx on lead_searches (status, created_at desc);
create index if not exists lead_searches_user_idx on lead_searches (user_id, created_at desc);

create index if not exists lead_search_jobs_status_idx on lead_search_jobs (status, created_at desc);
create index if not exists lead_search_jobs_ws_idx on lead_search_jobs (workspace_id, created_at desc);

create index if not exists leads_created_idx on leads (created_at desc);
create index if not exists leads_source_idx on leads (source);
create index if not exists leads_status_idx on leads (status);

create index if not exists exports_created_idx on exports (created_at desc);
create index if not exists exports_status_idx on exports (status, created_at desc);
create index if not exists exports_user_idx on exports (user_id, created_at desc);

create index if not exists ai_requests_created_idx on ai_requests (created_at desc);
create index if not exists ai_requests_status_idx on ai_requests (status, created_at desc);
create index if not exists ai_requests_ws_idx on ai_requests (workspace_id, created_at desc);
create index if not exists ai_requests_user_idx on ai_requests (user_id, created_at desc);

create index if not exists webhook_events_received_idx on webhook_events (received_at desc);
create index if not exists webhook_events_status_idx on webhook_events (status, received_at desc);

create index if not exists activity_logs_created_idx on activity_logs (created_at desc);
create index if not exists activity_logs_actor_idx on activity_logs (actor_id, created_at desc);

create index if not exists usage_counters_period_idx on usage_counters (period_start desc);
create index if not exists lead_lists_ws_only_idx on lead_lists (workspace_id);

-- ---------------------------------------------------------------------------
-- 3) Admin data functions — service_role only
--
-- Each one is SECURITY DEFINER (so it may read auth.users and aggregate
-- across tenants) and is executable ONLY by `service_role`. The browser can
-- never reach them: `anon` and `authenticated` have no EXECUTE privilege, and
-- the server only ever calls them after it has verified the caller's JWT and
-- their admin role.
-- ---------------------------------------------------------------------------

-- --- 3a) auth.users lookups -------------------------------------------------

/** Email / sign-in / ban state for a set of users (auth.users is not exposed
    through PostgREST, so the console cannot read it any other way). */
create or replace function admin_auth_users(p_ids uuid[])
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz
)
language sql
security definer stable
set search_path = public
as $$
  select
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.banned_until
  from auth.users u
  where u.id = any(p_ids);
$$;
revoke execute on function admin_auth_users(uuid[]) from public, anon, authenticated;
grant execute on function admin_auth_users(uuid[]) to service_role;

-- --- 3b) Dashboard metrics --------------------------------------------------

/**
 * Every number the /admin dashboard shows, in one round trip.
 *
 * Deliberate accounting decisions (documented so the UI can label them):
 *  • "committed MRR" is the sum of plan prices for subscriptions that are
 *    CURRENTLY entitling (active/trialing). It is a forward commitment, not
 *    cash collected; cancelled-but-still-entitled subscriptions are excluded
 *    because they will not renew.
 *  • "collected" is the real sum of captured payments in the window.
 *  • Plan distribution uses effective_plan_for_user() — the same entitlement
 *    rule the product enforces — never `subscriptions.plan_id` alone.
 */
create or replace function admin_overview_metrics(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'users', jsonb_build_object(
      'total', (select count(*) from profiles),
      'new', (select count(*) from profiles where created_at >= p_from and created_at < p_to),
      'admins', (select count(*) from profiles where role = 'admin'),
      'active', (
        select count(distinct a.user_id) from (
          select user_id from lead_searches where created_at >= p_from and created_at < p_to
          union
          select user_id from exports where created_at >= p_from and created_at < p_to
          union
          select user_id from ai_requests where user_id is not null and created_at >= p_from and created_at < p_to
          union
          select user_id from app_sessions where last_seen_at >= p_from and last_seen_at < p_to
        ) a
      ),
      'by_plan', (
        select coalesce(jsonb_object_agg(t.plan_id, t.c), '{}'::jsonb)
        from (
          select effective_plan_for_user(p.id) as plan_id, count(*)::int as c
          from profiles p group by 1
        ) t
      )
    ),
    'billing', jsonb_build_object(
      'active_paid_subscriptions', (
        select count(*) from subscriptions
        where status in ('active', 'trialing') and plan_id <> 'free'
      ),
      'committed_mrr_minor', (
        select coalesce(sum(pl.price_cents), 0)
        from subscriptions s join plans pl on pl.id = s.plan_id
        where s.status in ('active', 'trialing')
      ),
      'currency', (select coalesce(max(currency), 'INR') from plans),
      'by_status', (
        select coalesce(jsonb_object_agg(t.status, t.c), '{}'::jsonb)
        from (select status, count(*)::int as c from subscriptions group by 1) t
      ),
      'collected_minor', (
        select coalesce(sum(amount_cents), 0) from payments
        where status = 'captured' and created_at >= p_from and created_at < p_to
      ),
      'payments', (
        select count(*) from payments where created_at >= p_from and created_at < p_to
      ),
      'failed_payments', (
        select count(*) from payments
        where status = 'failed' and created_at >= p_from and created_at < p_to
      ),
      'refunded', (
        select count(*) from payments
        where status = 'refunded' and created_at >= p_from and created_at < p_to
      ),
      'refunded_minor', (
        select coalesce(sum(amount_cents), 0) from payments
        where status = 'refunded' and created_at >= p_from and created_at < p_to
      ),
      'cancellations', (
        select count(*) from subscriptions
        where cancel_at is not null and cancel_at >= p_from and cancel_at < p_to
      ),
      'pending_cancellations', (
        select count(*) from subscriptions where cancel_at_cycle_end
      ),
      'upcoming_renewals', (
        select count(*) from subscriptions
        where status in ('active', 'trialing')
          and coalesce(charge_at, current_period_end) >= now()
          and coalesce(charge_at, current_period_end) < now() + interval '30 days'
      ),
      'paying_customers', (
        select count(distinct user_id) from payments where status = 'captured'
      )
    ),
    'product', jsonb_build_object(
      'searches_today', (select count(*) from lead_searches where created_at >= date_trunc('day', now())),
      'searches_week', (select count(*) from lead_searches where created_at >= now() - interval '7 days'),
      'searches_month', (select count(*) from lead_searches where created_at >= date_trunc('month', now())),
      'searches_range', (select count(*) from lead_searches where created_at >= p_from and created_at < p_to),
      'leads_discovered', (select count(*) from leads where created_at >= p_from and created_at < p_to),
      'leads_total', (select count(*) from leads),
      'leads_saved', (
        select count(*) from lead_list_members where added_at >= p_from and added_at < p_to
      ),
      'exports', (select count(*) from exports where created_at >= p_from and created_at < p_to),
      'ai_requests', (select count(*) from ai_requests where created_at >= p_from and created_at < p_to),
      'workspaces_total', (select count(*) from workspaces),
      'workspaces_active', (
        select count(distinct workspace_id) from lead_searches
        where created_at >= p_from and created_at < p_to
      ),
      'client_workspaces', (select count(*) from workspaces where is_client),
      'client_workspaces_active', (
        select count(distinct s.workspace_id) from lead_searches s
        join workspaces w on w.id = s.workspace_id
        where w.is_client and s.created_at >= p_from and s.created_at < p_to
      )
    ),
    'operations', jsonb_build_object(
      'failed_searches', (
        select count(*) from lead_searches
        where status = 'failed' and created_at >= p_from and created_at < p_to
      ),
      'partial_searches', (
        select count(*) from lead_searches
        where status = 'partial' and created_at >= p_from and created_at < p_to
      ),
      'failed_exports', (
        select count(*) from exports
        where status = 'failed' and created_at >= p_from and created_at < p_to
      ),
      'failed_ai', (
        select count(*) from ai_requests
        where status = 'failed' and created_at >= p_from and created_at < p_to
      ),
      'failed_webhooks', (
        select count(*) from webhook_events
        where status = 'failed' and received_at >= p_from and received_at < p_to
      ),
      'unprocessed_webhooks', (
        select count(*) from webhook_events where status = 'received'
      ),
      'failed_payments_recent', (
        select count(*) from payments
        where status = 'failed' and created_at >= now() - interval '7 days'
      ),
      'jobs_running', (
        select count(*) from lead_search_jobs
        where status in ('queued', 'processing', 'fetching', 'normalizing', 'deduplicating', 'saving')
      ),
      'jobs_stuck', (
        select count(*) from lead_search_jobs
        where status in ('queued', 'processing', 'fetching', 'normalizing', 'deduplicating', 'saving')
          and created_at < now() - interval '30 minutes'
      ),
      'searches_processing', (
        select count(*) from lead_searches
        where status in ('queued', 'processing', 'fetching', 'normalizing', 'deduplicating', 'saving')
      )
    )
  );
$$;
revoke execute on function admin_overview_metrics(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function admin_overview_metrics(timestamptz, timestamptz) to service_role;

/** Daily buckets for the dashboard charts. Real counts only — an empty
    database returns zeroes, never sample data. */
create or replace function admin_timeseries(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  with days as (
    select generate_series(
      date_trunc('day', p_from),
      date_trunc('day', greatest(p_to - interval '1 millisecond', p_from)),
      interval '1 day'
    ) as d
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(days.d, 'YYYY-MM-DD'),
        'signups', (select count(*) from profiles p where p.created_at >= days.d and p.created_at < days.d + interval '1 day'),
        'searches', (select count(*) from lead_searches s where s.created_at >= days.d and s.created_at < days.d + interval '1 day'),
        'failed_searches', (select count(*) from lead_searches s where s.status = 'failed' and s.created_at >= days.d and s.created_at < days.d + interval '1 day'),
        'leads', (select count(*) from leads l where l.created_at >= days.d and l.created_at < days.d + interval '1 day'),
        'ai_requests', (select count(*) from ai_requests a where a.created_at >= days.d and a.created_at < days.d + interval '1 day'),
        'collected_minor', (select coalesce(sum(pm.amount_cents), 0) from payments pm where pm.status = 'captured' and pm.created_at >= days.d and pm.created_at < days.d + interval '1 day')
      )
      order by days.d
    ),
    '[]'::jsonb
  )
  from days;
$$;
revoke execute on function admin_timeseries(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function admin_timeseries(timestamptz, timestamptz) to service_role;

-- --- 3c) Customer directory + customer 360 ----------------------------------

/**
 * Paginated, filtered, sorted customer directory.
 *
 * Sorting is applied with a whitelist (no dynamic SQL from caller input) and
 * the total count is computed over the same filter, so the pager is honest.
 */
create or replace function admin_user_directory(
  p_search text default null,
  p_plan text default null,
  p_role text default null,
  p_sub_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sort text default 'created_at',
  p_dir text default 'desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer stable
set search_path = public
as $$
declare
  order_sql text;
  dir_sql text;
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  off integer := greatest(coalesce(p_offset, 0), 0);
  needle text := nullif(btrim(coalesce(p_search, '')), '');
  result jsonb;
begin
  order_sql := case lower(coalesce(p_sort, ''))
    when 'name' then 'lower(name)'
    when 'email' then 'lower(coalesce(email, ''''))'
    when 'plan' then 'plan_id'
    when 'leads_used' then 'leads_used'
    when 'last_activity' then 'last_activity_at'
    when 'workspaces' then 'workspace_count'
    else 'created_at'
  end;
  dir_sql := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;

  execute format($q$
    with base as (
      select
        p.id,
        p.name,
        p.role,
        p.created_at,
        p.avatar_url,
        au.email::text as email,
        au.last_sign_in_at,
        au.banned_until,
        au.email_confirmed_at,
        effective_plan_for_user(p.id) as plan_id,
        s.status as subscription_status,
        s.plan_id as subscribed_plan_id,
        s.razorpay_subscription_id,
        s.current_period_end,
        s.cancel_at_cycle_end,
        (select count(*)::int from workspace_members m where m.user_id = p.id) as workspace_count,
        (select count(*)::int from workspaces w where w.owner_id = p.id) as owned_workspaces,
        (
          select coalesce(sum(uc.leads_used), 0)::int
          from usage_counters uc
          join workspaces w2 on w2.id = uc.workspace_id
          where w2.owner_id = p.id and uc.period_start = date_trunc('month', now())::date
        ) as leads_used,
        greatest(
          coalesce((select max(ls.created_at) from lead_searches ls where ls.user_id = p.id), 'epoch'::timestamptz),
          coalesce((select max(ap.last_seen_at) from app_sessions ap where ap.user_id = p.id), 'epoch'::timestamptz),
          coalesce(au.last_sign_in_at, 'epoch'::timestamptz)
        ) as last_activity_raw
      from profiles p
      left join auth.users au on au.id = p.id
      left join subscriptions s on s.user_id = p.id
    ),
    shaped as (
      select
        b.*,
        nullif(b.last_activity_raw, 'epoch'::timestamptz) as last_activity_at
      from base b
    ),
    filtered as (
      select * from shaped f
      where ($1 is null
             or f.name ilike '%%' || $1 || '%%'
             or coalesce(f.email, '') ilike '%%' || $1 || '%%'
             or f.id::text = $1)
        and ($2 is null or f.plan_id = $2)
        and ($3 is null or f.role = $3)
        and ($4 is null or coalesce(f.subscription_status, 'none') = $4)
        and ($5 is null or f.created_at >= $5)
        and ($6 is null or f.created_at < $6)
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(page) - 'last_activity_raw')
        from (
          select * from filtered order by %s %s nulls last, created_at desc limit %s offset %s
        ) page
      ), '[]'::jsonb)
    )
  $q$, order_sql, dir_sql, lim, off)
  into result
  using needle,
        nullif(btrim(coalesce(p_plan, '')), ''),
        nullif(btrim(coalesce(p_role, '')), ''),
        nullif(btrim(coalesce(p_sub_status, '')), ''),
        p_from,
        p_to;

  return coalesce(result, jsonb_build_object('total', 0, 'rows', '[]'::jsonb));
end;
$$;
revoke execute on function admin_user_directory(text, text, text, text, timestamptz, timestamptz, text, text, integer, integer) from public, anon, authenticated;
grant execute on function admin_user_directory(text, text, text, text, timestamptz, timestamptz, text, text, integer, integer) to service_role;

/**
 * Customer 360 — everything support needs to answer "what is wrong with this
 * account" without opening the Supabase dashboard. Read-only.
 */
create or replace function admin_user_detail(p_user uuid)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select case when p.id is null then null else jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'role', p.role,
      'avatar_url', p.avatar_url,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'preferences', p.preferences
    ),
    'auth', jsonb_build_object(
      'email', au.email::text,
      'created_at', au.created_at,
      'last_sign_in_at', au.last_sign_in_at,
      'email_confirmed_at', au.email_confirmed_at,
      'banned_until', au.banned_until
    ),
    'plan', jsonb_build_object(
      'effective', effective_plan_for_user(p.id),
      'entitlements', (
        select to_jsonb(pl) from plans pl where pl.id = effective_plan_for_user(p.id)
      )
    ),
    'subscription', (
      select to_jsonb(s) from subscriptions s where s.user_id = p.id
    ),
    'checkouts', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from (
        select id, plan_id, razorpay_subscription_id, status, amount_cents, currency, created_at, completed_at
        from subscription_checkouts where user_id = p.id
        order by created_at desc limit 5
      ) c
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(pay) order by pay.created_at desc)
      from (
        select id, razorpay_payment_id, razorpay_subscription_id, amount_cents, currency, status, method, created_at, captured_at
        from payments where user_id = p.id
        order by created_at desc limit 10
      ) pay
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(inv) order by inv.issued_at desc)
      from (
        select id, number, description, amount_cents, currency, status, razorpay_invoice_id, issued_at, period_start, period_end
        from invoices where user_id = p.id
        order by issued_at desc limit 10
      ) inv
    ), '[]'::jsonb),
    'workspaces', coalesce((
      select jsonb_agg(ws order by ws->>'created_at' desc)
      from (
        select jsonb_build_object(
          'id', w.id,
          'name', w.name,
          'is_client', w.is_client,
          'created_at', w.created_at,
          'owner_id', w.owner_id,
          'is_owner', w.owner_id = p.id,
          'member_role', m.role,
          'plan_id', workspace_plan(w.id),
          'member_count', (select count(*)::int from workspace_members m2 where m2.workspace_id = w.id),
          'leads_used', coalesce((
            select uc.leads_used from usage_counters uc
            where uc.workspace_id = w.id and uc.period_start = date_trunc('month', now())::date
          ), 0),
          'searches', coalesce((
            select uc.searches from usage_counters uc
            where uc.workspace_id = w.id and uc.period_start = date_trunc('month', now())::date
          ), 0),
          'leads_total', (select count(*)::int from leads l where l.workspace_id = w.id)
        ) as ws
        from workspaces w
        left join workspace_members m on m.workspace_id = w.id and m.user_id = p.id
        where w.owner_id = p.id or m.user_id = p.id
      ) t
    ), '[]'::jsonb),
    'usage', jsonb_build_object(
      'period_start', date_trunc('month', now())::date,
      'leads_used', coalesce((
        select sum(uc.leads_used)::int from usage_counters uc
        join workspaces w on w.id = uc.workspace_id
        where w.owner_id = p.id and uc.period_start = date_trunc('month', now())::date
      ), 0),
      'searches', coalesce((
        select sum(uc.searches)::int from usage_counters uc
        join workspaces w on w.id = uc.workspace_id
        where w.owner_id = p.id and uc.period_start = date_trunc('month', now())::date
      ), 0),
      'exports', coalesce((
        select sum(uc.exports)::int from usage_counters uc
        join workspaces w on w.id = uc.workspace_id
        where w.owner_id = p.id and uc.period_start = date_trunc('month', now())::date
      ), 0),
      'ai_runs', coalesce((
        select sum(uc.ai_runs)::int from usage_counters uc
        join workspaces w on w.id = uc.workspace_id
        where w.owner_id = p.id and uc.period_start = date_trunc('month', now())::date
      ), 0),
      'history', coalesce((
        select jsonb_agg(h order by h->>'period_start')
        from (
          select jsonb_build_object(
            'period_start', uc.period_start,
            'leads_used', sum(uc.leads_used)::int,
            'searches', sum(uc.searches)::int,
            'exports', sum(uc.exports)::int,
            'ai_runs', sum(uc.ai_runs)::int
          ) as h
          from usage_counters uc
          join workspaces w on w.id = uc.workspace_id
          where w.owner_id = p.id
          group by uc.period_start
          order by uc.period_start desc
          limit 12
        ) t
      ), '[]'::jsonb)
    ),
    'searches', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from (
        select ls.id, ls.query, ls.location, ls.status, ls.result_count, ls.requested_count,
               ls.error, ls.created_at, ls.completed_at, ls.workspace_id,
               (select w.name from workspaces w where w.id = ls.workspace_id) as workspace_name
        from lead_searches ls where ls.user_id = p.id
        order by ls.created_at desc limit 10
      ) s
    ), '[]'::jsonb),
    'exports', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (
        select id, file_name, source, lead_count, status, error, created_at, completed_at
        from exports where user_id = p.id
        order by created_at desc limit 10
      ) e
    ), '[]'::jsonb),
    'ai_requests', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from (
        select id, kind, status, model, error, created_at
        from ai_requests where user_id = p.id
        order by created_at desc limit 10
      ) a
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(al) order by al.created_at desc)
      from (
        select id, workspace_id, kind, text, created_at
        from activity_logs where actor_id = p.id
        order by created_at desc limit 20
      ) al
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(ss) order by ss.last_seen_at desc)
      from (
        select id, user_agent, created_at, last_seen_at, revoked_at
        from app_sessions where user_id = p.id
        order by last_seen_at desc limit 10
      ) ss
    ), '[]'::jsonb),
    'admin_actions', coalesce((
      select jsonb_agg(to_jsonb(aa) order by aa.created_at desc)
      from (
        select id, admin_email, admin_name, action, summary, result, created_at
        from admin_audit_logs
        where target_type = 'user' and target_id = p.id::text
        order by created_at desc limit 20
      ) aa
    ), '[]'::jsonb)
  ) end
  from profiles p
  left join auth.users au on au.id = p.id
  where p.id = p_user;
$$;
revoke execute on function admin_user_detail(uuid) from public, anon, authenticated;
grant execute on function admin_user_detail(uuid) to service_role;

-- --- 3d) Workspace directory + workspace 360 --------------------------------

create or replace function admin_workspace_directory(
  p_search text default null,
  p_plan text default null,
  p_client text default null,       -- 'client' | 'personal' | null
  p_activity text default null,     -- 'active' | 'idle' | null (30-day window)
  p_sort text default 'created_at',
  p_dir text default 'desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer stable
set search_path = public
as $$
declare
  order_sql text;
  dir_sql text;
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  off integer := greatest(coalesce(p_offset, 0), 0);
  needle text := nullif(btrim(coalesce(p_search, '')), '');
  result jsonb;
begin
  order_sql := case lower(coalesce(p_sort, ''))
    when 'name' then 'lower(name)'
    when 'owner' then 'lower(coalesce(owner_name, ''''))'
    when 'members' then 'member_count'
    when 'leads_used' then 'leads_used'
    when 'leads_total' then 'leads_total'
    when 'searches' then 'searches'
    else 'created_at'
  end;
  dir_sql := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;

  execute format($q$
    with base as (
      select
        w.id,
        w.name,
        w.is_client,
        w.created_at,
        w.owner_id,
        coalesce(pr.name, '') as owner_name,
        au.email::text as owner_email,
        workspace_plan(w.id) as plan_id,
        (select count(*)::int from workspace_members m where m.workspace_id = w.id) as member_count,
        (select count(*)::int from lead_lists ll where ll.workspace_id = w.id) as list_count,
        (select count(*)::int from leads l where l.workspace_id = w.id) as leads_total,
        coalesce(uc.leads_used, 0) as leads_used,
        coalesce(uc.searches, 0) as searches,
        coalesce(uc.exports, 0) as exports,
        coalesce(uc.ai_runs, 0) as ai_runs,
        (select max(ls.created_at) from lead_searches ls where ls.workspace_id = w.id) as last_search_at
      from workspaces w
      left join profiles pr on pr.id = w.owner_id
      left join auth.users au on au.id = w.owner_id
      left join usage_counters uc
        on uc.workspace_id = w.id and uc.period_start = date_trunc('month', now())::date
    ),
    filtered as (
      select * from base f
      where ($1 is null
             or f.name ilike '%%' || $1 || '%%'
             or f.owner_name ilike '%%' || $1 || '%%'
             or coalesce(f.owner_email, '') ilike '%%' || $1 || '%%'
             or f.id::text = $1)
        and ($2 is null or f.plan_id = $2)
        and ($3 is null
             or ($3 = 'client' and f.is_client)
             or ($3 = 'personal' and not f.is_client))
        and ($4 is null
             or ($4 = 'active' and f.last_search_at >= now() - interval '30 days')
             or ($4 = 'idle' and (f.last_search_at is null or f.last_search_at < now() - interval '30 days')))
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(to_jsonb(page))
        from (
          select * from filtered order by %s %s nulls last, created_at desc limit %s offset %s
        ) page
      ), '[]'::jsonb)
    )
  $q$, order_sql, dir_sql, lim, off)
  into result
  using needle,
        nullif(btrim(coalesce(p_plan, '')), ''),
        nullif(btrim(coalesce(p_client, '')), ''),
        nullif(btrim(coalesce(p_activity, '')), '');

  return coalesce(result, jsonb_build_object('total', 0, 'rows', '[]'::jsonb));
end;
$$;
revoke execute on function admin_workspace_directory(text, text, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function admin_workspace_directory(text, text, text, text, text, text, integer, integer) to service_role;

create or replace function admin_workspace_detail(p_workspace uuid)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select case when w.id is null then null else jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', w.id,
      'name', w.name,
      'is_client', w.is_client,
      'created_at', w.created_at,
      'updated_at', w.updated_at,
      'stored_plan_id', w.plan_id,
      'plan_id', workspace_plan(w.id),
      'entitlements', (select to_jsonb(pl) from plans pl where pl.id = workspace_plan(w.id))
    ),
    'owner', jsonb_build_object(
      'id', w.owner_id,
      'name', coalesce((select pr.name from profiles pr where pr.id = w.owner_id), ''),
      'email', (select au.email::text from auth.users au where au.id = w.owner_id),
      'subscription_status', (select s.status from subscriptions s where s.user_id = w.owner_id)
    ),
    'members', coalesce((
      select jsonb_agg(m order by m->>'created_at')
      from (
        select jsonb_build_object(
          'user_id', wm.user_id,
          'role', wm.role,
          'created_at', wm.created_at,
          'name', coalesce(pr.name, ''),
          'email', au.email::text,
          'is_owner', wm.user_id = w.owner_id
        ) as m
        from workspace_members wm
        left join profiles pr on pr.id = wm.user_id
        left join auth.users au on au.id = wm.user_id
        where wm.workspace_id = w.id
      ) t
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.created_at desc)
      from (
        select id, email, role, status, created_at from workspace_invitations
        where workspace_id = w.id order by created_at desc limit 20
      ) i
    ), '[]'::jsonb),
    'usage', jsonb_build_object(
      'current', coalesce((
        select to_jsonb(uc) from usage_counters uc
        where uc.workspace_id = w.id and uc.period_start = date_trunc('month', now())::date
      ), jsonb_build_object(
        'workspace_id', w.id,
        'period_start', date_trunc('month', now())::date,
        'leads_used', 0, 'searches', 0, 'exports', 0, 'ai_runs', 0
      )),
      'history', coalesce((
        select jsonb_agg(to_jsonb(h) order by h.period_start)
        from (
          select period_start, leads_used, searches, exports, ai_runs
          from usage_counters where workspace_id = w.id
          order by period_start desc limit 12
        ) h
      ), '[]'::jsonb)
    ),
    'searches', jsonb_build_object(
      'by_status', coalesce((
        select jsonb_object_agg(t.status, t.c)
        from (select status, count(*)::int as c from lead_searches where workspace_id = w.id group by 1) t
      ), '{}'::jsonb),
      'recent', coalesce((
        select jsonb_agg(to_jsonb(s) order by s.created_at desc)
        from (
          select ls.id, ls.query, ls.location, ls.status, ls.requested_count, ls.result_count,
                 ls.error, ls.created_at, ls.completed_at,
                 coalesce((select pr.name from profiles pr where pr.id = ls.user_id), '') as user_name
          from lead_searches ls where ls.workspace_id = w.id
          order by ls.created_at desc limit 20
        ) s
      ), '[]'::jsonb)
    ),
    'jobs', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.created_at desc)
      from (
        select id, search_id, status, requested_count, processed_count, current_stage, error, created_at, completed_at
        from lead_search_jobs where workspace_id = w.id
        order by created_at desc limit 10
      ) j
    ), '[]'::jsonb),
    'leads', jsonb_build_object(
      'total', (select count(*) from leads where workspace_id = w.id),
      'with_email', (select count(*) from leads where workspace_id = w.id and coalesce(email, '') <> ''),
      'with_phone', (select count(*) from leads where workspace_id = w.id and coalesce(phone, '') <> ''),
      'with_website', (select count(*) from leads where workspace_id = w.id and coalesce(website, '') <> ''),
      'by_status', coalesce((
        select jsonb_object_agg(t.status, t.c)
        from (select status, count(*)::int as c from leads where workspace_id = w.id group by 1) t
      ), '{}'::jsonb),
      'by_source', coalesce((
        select jsonb_object_agg(t.source, t.c)
        from (select coalesce(source, 'unknown') as source, count(*)::int as c from leads where workspace_id = w.id group by 1) t
      ), '{}'::jsonb),
      'by_business_size', coalesce((
        select jsonb_object_agg(t.business_size, t.c)
        from (select business_size, count(*)::int as c from leads where workspace_id = w.id group by 1) t
      ), '{}'::jsonb)
    ),
    'lists', jsonb_build_object(
      'count', (select count(*) from lead_lists where workspace_id = w.id),
      'top', coalesce((
        select jsonb_agg(to_jsonb(l) order by l.size desc)
        from (
          select ll.id, ll.name, ll.created_at,
                 (select count(*)::int from lead_list_members lm where lm.list_id = ll.id) as size
          from lead_lists ll where ll.workspace_id = w.id
          order by size desc limit 10
        ) l
      ), '[]'::jsonb)
    ),
    'exports', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (
        select id, file_name, source, lead_count, status, error, created_at, completed_at
        from exports where workspace_id = w.id
        order by created_at desc limit 10
      ) e
    ), '[]'::jsonb),
    'ai', jsonb_build_object(
      'total', (select count(*) from ai_requests where workspace_id = w.id),
      'failed', (select count(*) from ai_requests where workspace_id = w.id and status = 'failed'),
      'recent', coalesce((
        select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from (
          select id, kind, status, model, error, created_at
          from ai_requests where workspace_id = w.id
          order by created_at desc limit 10
        ) a
      ), '[]'::jsonb)
    ),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(al) order by al.created_at desc)
      from (
        select id, kind, text, created_at, actor_id
        from activity_logs where workspace_id = w.id
        order by created_at desc limit 25
      ) al
    ), '[]'::jsonb),
    'admin_actions', coalesce((
      select jsonb_agg(to_jsonb(aa) order by aa.created_at desc)
      from (
        select id, admin_email, action, summary, result, created_at
        from admin_audit_logs
        where target_type = 'workspace' and target_id = w.id::text
        order by created_at desc limit 20
      ) aa
    ), '[]'::jsonb)
  ) end
  from workspaces w
  where w.id = p_workspace;
$$;
revoke execute on function admin_workspace_detail(uuid) from public, anon, authenticated;
grant execute on function admin_workspace_detail(uuid) to service_role;

-- --- 3e) Search operations --------------------------------------------------

create or replace function admin_search_directory(
  p_search text default null,
  p_status text default null,
  p_workspace uuid default null,
  p_user uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  with filtered as (
    select
      ls.id,
      ls.query,
      ls.location,
      ls.status,
      ls.requested_count,
      ls.result_count,
      ls.error,
      ls.created_at,
      ls.completed_at,
      ls.saved_list_id,
      ls.workspace_id,
      ls.user_id,
      coalesce(w.name, '') as workspace_name,
      coalesce(pr.name, '') as user_name,
      au.email::text as user_email
    from lead_searches ls
    left join workspaces w on w.id = ls.workspace_id
    left join profiles pr on pr.id = ls.user_id
    left join auth.users au on au.id = ls.user_id
    where (nullif(btrim(coalesce(p_search, '')), '') is null
           or ls.query ilike '%' || btrim(p_search) || '%'
           or coalesce(ls.location, '') ilike '%' || btrim(p_search) || '%'
           or ls.id::text = btrim(p_search))
      and (nullif(btrim(coalesce(p_status, '')), '') is null
           or (p_status = 'failed_only' and ls.status = 'failed')
           or (p_status = 'processing_only' and ls.status in ('queued', 'processing', 'fetching', 'normalizing', 'deduplicating', 'saving'))
           or ls.status = p_status)
      and (p_workspace is null or ls.workspace_id = p_workspace)
      and (p_user is null or ls.user_id = p_user)
      and (p_from is null or ls.created_at >= p_from)
      and (p_to is null or ls.created_at < p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'by_status', coalesce((
      select jsonb_object_agg(t.status, t.c)
      from (select status, count(*)::int as c from filtered group by 1) t
    ), '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.created_at desc)
      from (
        select * from filtered
        order by created_at desc
        limit least(greatest(coalesce(p_limit, 25), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) page
    ), '[]'::jsonb)
  );
$$;
revoke execute on function admin_search_directory(text, text, uuid, uuid, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function admin_search_directory(text, text, uuid, uuid, timestamptz, timestamptz, integer, integer) to service_role;

create or replace function admin_search_detail(p_search_id uuid)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select case when ls.id is null then null else jsonb_build_object(
    'search', jsonb_build_object(
      'id', ls.id,
      'query', ls.query,
      'location', ls.location,
      'status', ls.status,
      'requested_count', ls.requested_count,
      'result_count', ls.result_count,
      'error', ls.error,
      'filters', ls.filters,
      'interpretation', ls.interpretation,
      'created_at', ls.created_at,
      'completed_at', ls.completed_at,
      'saved_list_id', ls.saved_list_id,
      'workspace_id', ls.workspace_id,
      'workspace_name', (select w.name from workspaces w where w.id = ls.workspace_id),
      'user_id', ls.user_id,
      'user_name', (select pr.name from profiles pr where pr.id = ls.user_id),
      'user_email', (select au.email::text from auth.users au where au.id = ls.user_id)
    ),
    'jobs', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.created_at desc)
      from (
        select id, status, requested_count, processed_count, current_stage, error, started_at, completed_at, created_at
        from lead_search_jobs where search_id = ls.id
        order by created_at desc
      ) j
    ), '[]'::jsonb),
    'leads', jsonb_build_object(
      'count', (select count(*) from leads l where l.search_id = ls.id),
      'with_email', (select count(*) from leads l where l.search_id = ls.id and coalesce(l.email, '') <> ''),
      'with_phone', (select count(*) from leads l where l.search_id = ls.id and coalesce(l.phone, '') <> ''),
      'with_website', (select count(*) from leads l where l.search_id = ls.id and coalesce(l.website, '') <> ''),
      'sample', coalesce((
        select jsonb_agg(to_jsonb(s) order by s.collected_at desc)
        from (
          select id, name, category, city, country, rating, reviews,
                 coalesce(email, '') <> '' as has_email,
                 coalesce(phone, '') <> '' as has_phone,
                 coalesce(website, '') <> '' as has_website,
                 collected_at
          from leads where search_id = ls.id
          order by collected_at desc limit 10
        ) s
      ), '[]'::jsonb)
    )
  ) end
  from lead_searches ls
  where ls.id = p_search_id;
$$;
revoke execute on function admin_search_detail(uuid) from public, anon, authenticated;
grant execute on function admin_search_detail(uuid) to service_role;

-- --- 3f) Global lead operations --------------------------------------------

/**
 * Aggregate-only lead operations view. It never streams lead rows to the
 * browser: the console shows coverage/quality/volume, and drilling into
 * actual records happens inside the owning workspace.
 */
create or replace function admin_leads_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from leads),
    'in_range', (select count(*) from leads where created_at >= p_from and created_at < p_to),
    'coverage', jsonb_build_object(
      'email', (select count(*) from leads where coalesce(email, '') <> ''),
      'phone', (select count(*) from leads where coalesce(phone, '') <> ''),
      'website', (select count(*) from leads where coalesce(website, '') <> ''),
      'rating', (select count(*) from leads where rating is not null),
      'address', (select count(*) from leads where coalesce(address, '') <> '')
    ),
    'by_status', coalesce((
      select jsonb_object_agg(t.status, t.c)
      from (select status, count(*)::int as c from leads group by 1) t
    ), '{}'::jsonb),
    'by_source', coalesce((
      select jsonb_object_agg(t.source, t.c)
      from (select coalesce(nullif(source, ''), 'unknown') as source, count(*)::int as c from leads group by 1) t
    ), '{}'::jsonb),
    'by_provider', coalesce((
      select jsonb_object_agg(t.provider, t.c)
      from (select coalesce(nullif(provider, ''), 'unknown') as provider, count(*)::int as c from leads group by 1) t
    ), '{}'::jsonb),
    'by_business_size', coalesce((
      select jsonb_object_agg(t.business_size, t.c)
      from (select business_size, count(*)::int as c from leads group by 1) t
    ), '{}'::jsonb),
    'cross_workspace_duplicates', (
      select greatest(count(*) - count(distinct dedupe_key), 0) from leads
    ),
    'top_workspaces', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.leads desc)
      from (
        select l.workspace_id,
               coalesce(w.name, '') as workspace_name,
               count(*)::int as leads,
               count(*) filter (where l.created_at >= p_from and l.created_at < p_to)::int as leads_in_range
        from leads l
        left join workspaces w on w.id = l.workspace_id
        group by l.workspace_id, w.name
        order by leads desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'ingestion', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'leads', d.c) order by d.day)
      from (
        select date_trunc('day', created_at) as day, count(*)::int as c
        from leads
        where created_at >= p_from and created_at < p_to
        group by 1
      ) d
    ), '[]'::jsonb)
  );
$$;
revoke execute on function admin_leads_overview(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function admin_leads_overview(timestamptz, timestamptz) to service_role;

-- --- 3g) Usage + quota administration ---------------------------------------

/**
 * Usage rollup for a billing period, read from `usage_counters` — the exact
 * table reserve_leads() meters against. The console therefore cannot
 * contradict the customer-facing /usage page.
 */
create or replace function admin_usage_rollup(
  p_period date default null,
  p_plan text default null,
  p_state text default null,   -- 'near' (>=80%) | 'exhausted' | 'active' | null
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  with period as (
    select coalesce(p_period, date_trunc('month', now())::date) as p
  ),
  rows as (
    select
      w.id as workspace_id,
      w.name as workspace_name,
      w.is_client,
      w.owner_id,
      coalesce(pr.name, '') as owner_name,
      au.email::text as owner_email,
      workspace_plan(w.id) as plan_id,
      coalesce(uc.leads_used, 0) as leads_used,
      coalesce(uc.searches, 0) as searches,
      coalesce(uc.exports, 0) as exports,
      coalesce(uc.ai_runs, 0) as ai_runs,
      coalesce(pl.lead_allowance, 0) as lead_allowance,
      case
        when coalesce(pl.lead_allowance, 0) > 0
        then round((coalesce(uc.leads_used, 0)::numeric / pl.lead_allowance) * 100, 1)
        else 0
      end as used_pct,
      (select p from period) as period_start
    from workspaces w
    left join profiles pr on pr.id = w.owner_id
    left join auth.users au on au.id = w.owner_id
    left join usage_counters uc
      on uc.workspace_id = w.id and uc.period_start = (select p from period)
    left join plans pl on pl.id = workspace_plan(w.id)
  ),
  filtered as (
    select * from rows r
    where (nullif(btrim(coalesce(p_search, '')), '') is null
           or r.workspace_name ilike '%' || btrim(p_search) || '%'
           or r.owner_name ilike '%' || btrim(p_search) || '%'
           or coalesce(r.owner_email, '') ilike '%' || btrim(p_search) || '%')
      and (nullif(btrim(coalesce(p_plan, '')), '') is null or r.plan_id = p_plan)
      and (nullif(btrim(coalesce(p_state, '')), '') is null
           or (p_state = 'near' and r.used_pct >= 80 and r.used_pct < 100)
           or (p_state = 'exhausted' and r.used_pct >= 100)
           or (p_state = 'active' and r.leads_used > 0))
  )
  select jsonb_build_object(
    'period_start', (select p from period),
    'total', (select count(*) from filtered),
    'totals', jsonb_build_object(
      'leads_used', (select coalesce(sum(leads_used), 0) from filtered),
      'searches', (select coalesce(sum(searches), 0) from filtered),
      'exports', (select coalesce(sum(exports), 0) from filtered),
      'ai_runs', (select coalesce(sum(ai_runs), 0) from filtered),
      'allowance', (select coalesce(sum(lead_allowance), 0) from filtered),
      'near_limit', (select count(*) from filtered where used_pct >= 80 and used_pct < 100),
      'exhausted', (select count(*) from filtered where used_pct >= 100),
      'active', (select count(*) from filtered where leads_used > 0)
    ),
    'by_plan', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.plan_id)
      from (
        select plan_id,
               count(*)::int as workspaces,
               coalesce(sum(leads_used), 0)::int as leads_used,
               coalesce(sum(searches), 0)::int as searches,
               coalesce(sum(exports), 0)::int as exports,
               coalesce(sum(ai_runs), 0)::int as ai_runs
        from filtered group by plan_id
      ) t
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.leads_used desc)
      from (
        select * from filtered
        order by leads_used desc, workspace_name asc
        limit least(greatest(coalesce(p_limit, 25), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) page
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.period_start)
      from (
        select period_start,
               sum(leads_used)::int as leads_used,
               sum(searches)::int as searches,
               sum(exports)::int as exports,
               sum(ai_runs)::int as ai_runs
        from usage_counters
        group by period_start
        order by period_start desc
        limit 12
      ) h
    ), '[]'::jsonb)
  );
$$;
revoke execute on function admin_usage_rollup(date, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function admin_usage_rollup(date, text, text, text, integer, integer) to service_role;

-- --- 3h) AI operations ------------------------------------------------------

create or replace function admin_ai_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from ai_requests where created_at >= p_from and created_at < p_to),
    'completed', (select count(*) from ai_requests where status = 'completed' and created_at >= p_from and created_at < p_to),
    'failed', (select count(*) from ai_requests where status = 'failed' and created_at >= p_from and created_at < p_to),
    'processing', (select count(*) from ai_requests where status = 'processing' and created_at >= p_from and created_at < p_to),
    -- `tokens` exists on the table but no code path writes it today, so the
    -- console reports the coverage honestly instead of inventing cost data.
    'token_rows', (select count(*) from ai_requests where tokens is not null and created_at >= p_from and created_at < p_to),
    'tokens_sum', (select coalesce(sum(tokens), 0) from ai_requests where created_at >= p_from and created_at < p_to),
    'by_kind', coalesce((
      select jsonb_object_agg(t.kind, t.c)
      from (select kind, count(*)::int as c from ai_requests where created_at >= p_from and created_at < p_to group by 1) t
    ), '{}'::jsonb),
    'by_model', coalesce((
      select jsonb_object_agg(t.model, t.c)
      from (select coalesce(nullif(model, ''), 'unknown') as model, count(*)::int as c from ai_requests where created_at >= p_from and created_at < p_to group by 1) t
    ), '{}'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'total', d.c, 'failed', d.f) order by d.day)
      from (
        select date_trunc('day', created_at) as day,
               count(*)::int as c,
               count(*) filter (where status = 'failed')::int as f
        from ai_requests
        where created_at >= p_from and created_at < p_to
        group by 1
      ) d
    ), '[]'::jsonb),
    'top_workspaces', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.requests desc)
      from (
        select a.workspace_id,
               coalesce(w.name, '') as workspace_name,
               count(*)::int as requests,
               count(*) filter (where a.status = 'failed')::int as failed
        from ai_requests a
        left join workspaces w on w.id = a.workspace_id
        where a.created_at >= p_from and a.created_at < p_to
        group by a.workspace_id, w.name
        order by requests desc limit 10
      ) t
    ), '[]'::jsonb),
    'top_users', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.requests desc)
      from (
        select a.user_id,
               coalesce(pr.name, '') as user_name,
               au.email::text as user_email,
               count(*)::int as requests,
               count(*) filter (where a.status = 'failed')::int as failed
        from ai_requests a
        left join profiles pr on pr.id = a.user_id
        left join auth.users au on au.id = a.user_id
        where a.created_at >= p_from and a.created_at < p_to and a.user_id is not null
        group by a.user_id, pr.name, au.email
        order by requests desc limit 10
      ) t
    ), '[]'::jsonb),
    'errors', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.c desc)
      from (
        select coalesce(nullif(btrim(error), ''), 'unknown') as error, count(*)::int as c
        from ai_requests
        where status = 'failed' and created_at >= p_from and created_at < p_to
        group by 1 order by c desc limit 10
      ) t
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from (
        select a.id, a.kind, a.status, a.model, a.error, a.created_at,
               a.workspace_id,
               coalesce(w.name, '') as workspace_name,
               coalesce(pr.name, '') as user_name
        from ai_requests a
        left join workspaces w on w.id = a.workspace_id
        left join profiles pr on pr.id = a.user_id
        where a.created_at >= p_from and a.created_at < p_to
        order by a.created_at desc limit 25
      ) r
    ), '[]'::jsonb)
  );
$$;
revoke execute on function admin_ai_overview(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function admin_ai_overview(timestamptz, timestamptz) to service_role;

-- --- 3i) Billing + revenue --------------------------------------------------

create or replace function admin_billing_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select jsonb_build_object(
    'subscriptions', jsonb_build_object(
      'total', (select count(*) from subscriptions),
      'entitling', (select count(*) from subscriptions where status in ('active', 'trialing')),
      'paid_active', (select count(*) from subscriptions where status in ('active', 'trialing') and plan_id <> 'free'),
      'cancel_at_cycle_end', (select count(*) from subscriptions where cancel_at_cycle_end),
      'by_status', coalesce((
        select jsonb_object_agg(t.status, t.c)
        from (select status, count(*)::int as c from subscriptions group by 1) t
      ), '{}'::jsonb),
      'by_plan', coalesce((
        select jsonb_object_agg(t.plan_id, t.c)
        from (
          select plan_id, count(*)::int as c from subscriptions
          where status in ('active', 'trialing') group by 1
        ) t
      ), '{}'::jsonb)
    ),
    'revenue', jsonb_build_object(
      'currency', (select coalesce(max(currency), 'INR') from plans),
      'committed_mrr_minor', (
        select coalesce(sum(pl.price_cents), 0)
        from subscriptions s join plans pl on pl.id = s.plan_id
        where s.status in ('active', 'trialing')
      ),
      'collected_minor', (
        select coalesce(sum(amount_cents), 0) from payments
        where status = 'captured' and created_at >= p_from and created_at < p_to
      ),
      'refunded_minor', (
        select coalesce(sum(amount_cents), 0) from payments
        where status = 'refunded' and created_at >= p_from and created_at < p_to
      ),
      'collected_lifetime_minor', (
        select coalesce(sum(amount_cents), 0) from payments where status = 'captured'
      ),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'collected_minor', d.amount, 'payments', d.c) order by d.day)
        from (
          select date_trunc('day', created_at) as day,
                 coalesce(sum(amount_cents) filter (where status = 'captured'), 0) as amount,
                 count(*)::int as c
          from payments
          where created_at >= p_from and created_at < p_to
          group by 1
        ) d
      ), '[]'::jsonb)
    ),
    'payments', jsonb_build_object(
      'in_range', (select count(*) from payments where created_at >= p_from and created_at < p_to),
      'by_status', coalesce((
        select jsonb_object_agg(t.status, t.c)
        from (
          select status, count(*)::int as c from payments
          where created_at >= p_from and created_at < p_to group by 1
        ) t
      ), '{}'::jsonb)
    ),
    'invoices', jsonb_build_object(
      'in_range', (select count(*) from invoices where issued_at >= p_from and issued_at < p_to),
      'by_status', coalesce((
        select jsonb_object_agg(t.status, t.c)
        from (
          select status, count(*)::int as c from invoices
          where issued_at >= p_from and issued_at < p_to group by 1
        ) t
      ), '{}'::jsonb)
    ),
    'upcoming_renewals', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.renews_at)
      from (
        select s.user_id,
               coalesce(pr.name, '') as user_name,
               au.email::text as user_email,
               s.plan_id,
               s.status,
               s.razorpay_subscription_id,
               coalesce(s.charge_at, s.current_period_end) as renews_at,
               s.cancel_at_cycle_end
        from subscriptions s
        left join profiles pr on pr.id = s.user_id
        left join auth.users au on au.id = s.user_id
        where s.status in ('active', 'trialing')
          and coalesce(s.charge_at, s.current_period_end) >= now()
          and coalesce(s.charge_at, s.current_period_end) < now() + interval '30 days'
        order by renews_at asc
        limit 25
      ) t
    ), '[]'::jsonb),
    'recent_webhooks', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.received_at desc)
      from (
        select id, provider, event_id, event_type, status, received_at, processed_at, error
        from webhook_events
        order by received_at desc limit 15
      ) t
    ), '[]'::jsonb)
  );
$$;
revoke execute on function admin_billing_overview(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function admin_billing_overview(timestamptz, timestamptz) to service_role;

/** Paginated payments/invoices/subscriptions lists with the customer joined in. */
create or replace function admin_billing_records(
  p_kind text,                      -- 'payments' | 'invoices' | 'subscriptions'
  p_search text default null,
  p_status text default null,
  p_plan text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  with needle as (select nullif(btrim(coalesce(p_search, '')), '') as q),
  status_filter as (select nullif(btrim(coalesce(p_status, '')), '') as s),
  plan_filter as (select nullif(btrim(coalesce(p_plan, '')), '') as p),
  payments_rows as (
    select
      pay.id::text as id,
      pay.created_at as at,
      pay.status,
      pay.amount_cents,
      pay.currency,
      pay.method,
      pay.razorpay_payment_id as provider_id,
      pay.razorpay_subscription_id as provider_subscription_id,
      null::text as number,
      null::text as plan_id,
      pay.user_id,
      coalesce(pr.name, '') as user_name,
      au.email::text as user_email
    from payments pay
    left join profiles pr on pr.id = pay.user_id
    left join auth.users au on au.id = pay.user_id
    where p_kind = 'payments'
      and ((select q from needle) is null
           or coalesce(pay.razorpay_payment_id, '') ilike '%' || (select q from needle) || '%'
           or coalesce(pay.razorpay_subscription_id, '') ilike '%' || (select q from needle) || '%'
           or coalesce(au.email::text, '') ilike '%' || (select q from needle) || '%'
           or coalesce(pr.name, '') ilike '%' || (select q from needle) || '%')
      and ((select s from status_filter) is null or pay.status = (select s from status_filter))
      and (p_from is null or pay.created_at >= p_from)
      and (p_to is null or pay.created_at < p_to)
  ),
  invoice_rows as (
    select
      inv.id::text as id,
      inv.issued_at as at,
      inv.status,
      inv.amount_cents,
      inv.currency,
      null::text as method,
      inv.razorpay_invoice_id as provider_id,
      null::text as provider_subscription_id,
      inv.number,
      null::text as plan_id,
      inv.user_id,
      coalesce(pr.name, '') as user_name,
      au.email::text as user_email
    from invoices inv
    left join profiles pr on pr.id = inv.user_id
    left join auth.users au on au.id = inv.user_id
    where p_kind = 'invoices'
      and ((select q from needle) is null
           or coalesce(inv.razorpay_invoice_id, '') ilike '%' || (select q from needle) || '%'
           or inv.number ilike '%' || (select q from needle) || '%'
           or coalesce(au.email::text, '') ilike '%' || (select q from needle) || '%'
           or coalesce(pr.name, '') ilike '%' || (select q from needle) || '%')
      and ((select s from status_filter) is null or inv.status = (select s from status_filter))
      and (p_from is null or inv.issued_at >= p_from)
      and (p_to is null or inv.issued_at < p_to)
  ),
  subscription_rows as (
    select
      sub.id::text as id,
      sub.updated_at as at,
      sub.status,
      coalesce(pl.price_cents, 0) as amount_cents,
      sub.currency,
      null::text as method,
      sub.razorpay_subscription_id as provider_id,
      sub.razorpay_subscription_id as provider_subscription_id,
      null::text as number,
      sub.plan_id,
      sub.user_id,
      coalesce(pr.name, '') as user_name,
      au.email::text as user_email
    from subscriptions sub
    left join plans pl on pl.id = sub.plan_id
    left join profiles pr on pr.id = sub.user_id
    left join auth.users au on au.id = sub.user_id
    where p_kind = 'subscriptions'
      and ((select q from needle) is null
           or coalesce(sub.razorpay_subscription_id, '') ilike '%' || (select q from needle) || '%'
           or coalesce(sub.razorpay_customer_id, '') ilike '%' || (select q from needle) || '%'
           or coalesce(au.email::text, '') ilike '%' || (select q from needle) || '%'
           or coalesce(pr.name, '') ilike '%' || (select q from needle) || '%')
      and ((select s from status_filter) is null or sub.status = (select s from status_filter))
      and ((select p from plan_filter) is null or sub.plan_id = (select p from plan_filter))
      and (p_from is null or sub.updated_at >= p_from)
      and (p_to is null or sub.updated_at < p_to)
  ),
  combined as (
    select * from payments_rows
    union all select * from invoice_rows
    union all select * from subscription_rows
  )
  select jsonb_build_object(
    'kind', p_kind,
    'total', (select count(*) from combined),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.at desc)
      from (
        select * from combined
        order by at desc
        limit least(greatest(coalesce(p_limit, 25), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) page
    ), '[]'::jsonb)
  );
$$;
revoke execute on function admin_billing_records(text, text, text, text, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function admin_billing_records(text, text, text, text, timestamptz, timestamptz, integer, integer) to service_role;

-- --- 3j) Webhooks -----------------------------------------------------------

create or replace function admin_webhook_directory(
  p_search text default null,
  p_status text default null,
  p_event_type text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  with filtered as (
    select
      we.id,
      we.provider,
      we.event_id,
      we.event_type,
      we.status,
      we.received_at,
      we.processed_at,
      we.error,
      we.attempts,
      nullif(we.payload #>> '{payload,subscription,entity,id}', '') as subscription_id,
      nullif(we.payload #>> '{payload,payment,entity,id}', '') as payment_id
    from webhook_events we
    where (nullif(btrim(coalesce(p_search, '')), '') is null
           or we.event_id ilike '%' || btrim(p_search) || '%'
           or coalesce(we.payload #>> '{payload,subscription,entity,id}', '') ilike '%' || btrim(p_search) || '%'
           or coalesce(we.payload #>> '{payload,payment,entity,id}', '') ilike '%' || btrim(p_search) || '%')
      and (nullif(btrim(coalesce(p_status, '')), '') is null or we.status = p_status)
      and (nullif(btrim(coalesce(p_event_type, '')), '') is null or we.event_type = p_event_type)
      and (p_from is null or we.received_at >= p_from)
      and (p_to is null or we.received_at < p_to)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'by_status', coalesce((
      select jsonb_object_agg(t.status, t.c)
      from (select status, count(*)::int as c from webhook_events group by 1) t
    ), '{}'::jsonb),
    'event_types', coalesce((
      select jsonb_agg(t.event_type order by t.event_type)
      from (select distinct event_type from webhook_events) t
    ), '[]'::jsonb),
    'last_received_at', (select max(received_at) from webhook_events),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(page) order by page.received_at desc)
      from (
        select * from filtered
        order by received_at desc
        limit least(greatest(coalesce(p_limit, 25), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) page
    ), '[]'::jsonb)
  );
$$;
revoke execute on function admin_webhook_directory(text, text, text, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function admin_webhook_directory(text, text, text, timestamptz, timestamptz, integer, integer) to service_role;

/**
 * One webhook event with the provider ids it refers to and the local rows
 * that were (or were not) written for them. This is what makes "did webhook
 * processing fail for this customer" answerable without the raw payload —
 * which is deliberately NOT returned in full, because Razorpay payloads can
 * carry contact details.
 */
create or replace function admin_webhook_detail(p_id uuid)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select case when we.id is null then null else jsonb_build_object(
    'event', jsonb_build_object(
      'id', we.id,
      'provider', we.provider,
      'event_id', we.event_id,
      'event_type', we.event_type,
      'status', we.status,
      'attempts', we.attempts,
      'received_at', we.received_at,
      'processed_at', we.processed_at,
      'error', we.error,
      'subscription_id', nullif(we.payload #>> '{payload,subscription,entity,id}', ''),
      'payment_id', nullif(we.payload #>> '{payload,payment,entity,id}', ''),
      'payment_status', nullif(we.payload #>> '{payload,payment,entity,status}', ''),
      'subscription_status', nullif(we.payload #>> '{payload,subscription,entity,status}', ''),
      'amount_minor', nullif(we.payload #>> '{payload,payment,entity,amount}', '')
    ),
    'subscription', (
      select to_jsonb(s) from subscriptions s
      where s.razorpay_subscription_id = nullif(we.payload #>> '{payload,subscription,entity,id}', '')
    ),
    'payment', (
      select to_jsonb(p) from payments p
      where p.razorpay_payment_id = nullif(we.payload #>> '{payload,payment,entity,id}', '')
    ),
    'customer', (
      select jsonb_build_object('id', pr.id, 'name', pr.name, 'email', au.email::text)
      from subscriptions s
      join profiles pr on pr.id = s.user_id
      left join auth.users au on au.id = s.user_id
      where s.razorpay_subscription_id = nullif(we.payload #>> '{payload,subscription,entity,id}', '')
    )
  ) end
  from webhook_events we
  where we.id = p_id;
$$;
revoke execute on function admin_webhook_detail(uuid) from public, anon, authenticated;
grant execute on function admin_webhook_detail(uuid) to service_role;

-- --- 3k) Operational health -------------------------------------------------

/** Database-side signals for /admin/system. Every number has a source row. */
create or replace function admin_ops_health(p_since timestamptz)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select jsonb_build_object(
    'since', p_since,
    'searches', jsonb_build_object(
      'total', (select count(*) from lead_searches where created_at >= p_since),
      'failed', (select count(*) from lead_searches where status = 'failed' and created_at >= p_since),
      'partial', (select count(*) from lead_searches where status = 'partial' and created_at >= p_since),
      'processing', (select count(*) from lead_searches where status in ('queued', 'processing', 'fetching', 'normalizing', 'deduplicating', 'saving')),
      'stuck', (select count(*) from lead_searches where status in ('queued', 'processing', 'fetching', 'normalizing', 'deduplicating', 'saving') and created_at < now() - interval '30 minutes'),
      'last_at', (select max(created_at) from lead_searches),
      'recent_errors', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (
          select id, workspace_id, left(coalesce(error, ''), 240) as error, created_at
          from lead_searches where status = 'failed' and created_at >= p_since
          order by created_at desc limit 10
        ) t
      ), '[]'::jsonb)
    ),
    'exports', jsonb_build_object(
      'total', (select count(*) from exports where created_at >= p_since),
      'failed', (select count(*) from exports where status = 'failed' and created_at >= p_since),
      'processing', (select count(*) from exports where status in ('preparing', 'processing')),
      'last_at', (select max(created_at) from exports),
      'recent_errors', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (
          select id, workspace_id, left(coalesce(error, ''), 240) as error, created_at
          from exports where status = 'failed' and created_at >= p_since
          order by created_at desc limit 10
        ) t
      ), '[]'::jsonb)
    ),
    'ai', jsonb_build_object(
      'total', (select count(*) from ai_requests where created_at >= p_since),
      'failed', (select count(*) from ai_requests where status = 'failed' and created_at >= p_since),
      'last_at', (select max(created_at) from ai_requests),
      'recent_errors', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (
          select id, workspace_id, kind, left(coalesce(error, ''), 240) as error, created_at
          from ai_requests where status = 'failed' and created_at >= p_since
          order by created_at desc limit 10
        ) t
      ), '[]'::jsonb)
    ),
    'billing', jsonb_build_object(
      'payments', (select count(*) from payments where created_at >= p_since),
      'failed_payments', (select count(*) from payments where status = 'failed' and created_at >= p_since),
      'last_payment_at', (select max(created_at) from payments),
      'past_due_subscriptions', (select count(*) from subscriptions where status in ('past_due', 'halted', 'pending'))
    ),
    'webhooks', jsonb_build_object(
      'total', (select count(*) from webhook_events where received_at >= p_since),
      'failed', (select count(*) from webhook_events where status = 'failed' and received_at >= p_since),
      'unprocessed', (select count(*) from webhook_events where status = 'received'),
      'last_at', (select max(received_at) from webhook_events),
      'recent_errors', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.received_at desc)
        from (
          select id, event_type, left(coalesce(error, ''), 240) as error, received_at
          from webhook_events where status = 'failed' and received_at >= p_since
          order by received_at desc limit 10
        ) t
      ), '[]'::jsonb)
    )
  );
$$;
revoke execute on function admin_ops_health(timestamptz) from public, anon, authenticated;
grant execute on function admin_ops_health(timestamptz) to service_role;

-- --- 3l) Administrator roster ----------------------------------------------

create or replace function admin_roster()
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'email', au.email::text,
        'created_at', p.created_at,
        'last_sign_in_at', au.last_sign_in_at,
        'banned_until', au.banned_until
      )
      order by p.created_at
    ),
    '[]'::jsonb
  )
  from profiles p
  left join auth.users au on au.id = p.id
  where p.role = 'admin';
$$;
revoke execute on function admin_roster() from public, anon, authenticated;
grant execute on function admin_roster() to service_role;

-- ---------------------------------------------------------------------------
-- 4) Privileged mutation: role management
--
--    profiles.role is protected by protect_profile_role() (migration 0003),
--    which blocks ANY role change that is not made by a logged-in admin. The
--    admin API talks to Postgres as service_role, where auth.uid() is null, so
--    the trigger would block the console too.
--
--    Rather than weakening the trigger, we give it one extra, deliberately
--    narrow escape hatch: a transaction-local GUC that only admin_grant_role()
--    can set. admin_grant_role() is execute-revoked from anon/authenticated,
--    so a customer can neither call it nor set the flag through PostgREST.
-- ---------------------------------------------------------------------------
create or replace function protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and not is_zybble_admin()
     and coalesce(current_setting('zybble.role_change', true), '') <> 'on' then
    raise exception 'Only an administrator can change profile roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on profiles;
create trigger profiles_protect_role
before update on profiles
for each row execute function protect_profile_role();

-- Grant or revoke the admin role. Refuses to remove the last administrator so
-- the console can never lock the company out of its own operations.
create or replace function admin_grant_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before text;
  v_admins int;
  v_email text;
  v_name text;
begin
  if p_role not in ('user', 'admin') then
    raise exception 'invalid_role';
  end if;

  select role, name into v_before, v_name from profiles where id = p_user for update;
  if not found then
    raise exception 'user_not_found';
  end if;

  if v_before = 'admin' and p_role <> 'admin' then
    select count(*) into v_admins from profiles where role = 'admin';
    if v_admins <= 1 then
      raise exception 'last_admin';
    end if;
  end if;

  perform set_config('zybble.role_change', 'on', true);
  update profiles set role = p_role, updated_at = now() where id = p_user;
  perform set_config('zybble.role_change', 'off', true);

  select email::text into v_email from auth.users where id = p_user;

  return jsonb_build_object(
    'before', v_before,
    'after', p_role,
    'email', v_email,
    'name', v_name
  );
end;
$$;
revoke execute on function admin_grant_role(uuid, text) from public, anon, authenticated;
grant execute on function admin_grant_role(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5) PostgREST must re-read the schema so the new functions are callable
--    immediately after this migration runs.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
