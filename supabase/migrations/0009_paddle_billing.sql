-- ============================================================================
-- Zybble — 0009: Razorpay → Paddle Billing migration.
--
-- WHAT THIS MIGRATION DOES
--
--   1. Adds provider-neutral billing columns to `subscriptions`, `payments`,
--      `invoices` and `subscription_checkouts`, backed by unique indexes, so
--      every NEW billing write is provider-neutral (`billing_provider`,
--      `provider_customer_id`, `provider_subscription_id`, `provider_price_id`,
--      `provider_payment_id`, `provider_invoice_id`, `provider_transaction_id`).
--      All new Paddle code writes ONLY these columns.
--
--   2. LEGACY DATA PRESERVATION. The old `razorpay_*` columns are deliberately
--      RETAINED (clearly marked legacy below) so historical payment records
--      stay intact. Nothing is migrated, fabricated or deleted: existing
--      Razorpay rows keep their recorded entitlement (`effective_plan_for_user`
--      still honours an active row until `current_period_end`), after which the
--      lapsed-subscription sweep moves them to Free. No Razorpay API call is
--      ever made by the application again.
--
--   3. Adds `lead_quota_state(uuid)` so the search API can return a dedicated,
--      machine-readable `monthly_lead_limit_reached` payload (current plan,
--      leads used, allowance) instead of a generic quota error.
--
--   4. Re-defines the 0008 admin console functions that selected Razorpay
--      columns so the admin console shows provider-neutral / Paddle ids
--      (with coalesce fallbacks so historical Razorpay records remain
--      searchable).
--
-- Safe to run repeatedly (idempotent). No destructive data loss: nothing is
-- dropped except indexes/constraints that are immediately recreated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Subscriptions — provider-neutral columns
-- ---------------------------------------------------------------------------
alter table subscriptions add column if not exists billing_provider text;
alter table subscriptions add column if not exists provider_customer_id text;
alter table subscriptions add column if not exists provider_subscription_id text;
alter table subscriptions add column if not exists provider_price_id text;
alter table subscriptions add column if not exists provider_transaction_id text;

-- Backfill: a row that carries a Razorpay subscription id is a legacy Razorpay
-- record; anything else predates Paddle wiring and is treated as provider-less
-- until the first Paddle checkout writes its own row.
update subscriptions
set billing_provider = 'razorpay'
where razorpay_subscription_id is not null
  and billing_provider is null;

update subscriptions
set billing_provider = 'none'
where billing_provider is null;

-- `none` marks historical rows with no provider binding; new rows are written
-- by server code with 'paddle' (or 'razorpay' for retained legacy rows).
alter table subscriptions alter column billing_provider set not null;
alter table subscriptions alter column billing_provider set default 'none';

-- One provider subscription may grant entitlement to at most ONE Zybble user.
create unique index if not exists subscriptions_provider_sub_uidx
  on subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists subscriptions_provider_sub_idx
  on subscriptions (provider_subscription_id);
create index if not exists subscriptions_provider_customer_idx
  on subscriptions (provider_customer_id);

-- ---------------------------------------------------------------------------
-- 2) Payments — provider-neutral columns
-- ---------------------------------------------------------------------------
alter table payments add column if not exists billing_provider text;
alter table payments add column if not exists provider_payment_id text;
alter table payments add column if not exists provider_subscription_id text;
alter table payments add column if not exists provider_transaction_id text;

update payments
set billing_provider = 'razorpay'
where razorpay_payment_id is not null
  and billing_provider is null;

update payments
set billing_provider = 'none'
where billing_provider is null;

alter table payments alter column billing_provider set not null;
alter table payments alter column billing_provider set default 'none';

create unique index if not exists payments_provider_payment_uidx
  on payments (provider_payment_id)
  where provider_payment_id is not null;

create index if not exists payments_provider_sub_idx
  on payments (provider_subscription_id);
create index if not exists payments_provider_txn_idx
  on payments (provider_transaction_id);

-- ---------------------------------------------------------------------------
-- 3) Invoices — provider-neutral columns
-- ---------------------------------------------------------------------------
alter table invoices add column if not exists billing_provider text;
alter table invoices add column if not exists provider_invoice_id text;
alter table invoices add column if not exists provider_transaction_id text;
alter table invoices add column if not exists provider_subscription_id text;

update invoices
set billing_provider = 'razorpay'
where razorpay_invoice_id is not null
  and billing_provider is null;

update invoices
set billing_provider = 'none'
where billing_provider is null;

alter table invoices alter column billing_provider set not null;
alter table invoices alter column billing_provider set default 'none';

create unique index if not exists invoices_provider_invoice_uidx
  on invoices (provider_invoice_id)
  where provider_invoice_id is not null;

-- ---------------------------------------------------------------------------
-- 4) Pending provider checkouts — Paddle checkout intents
--
--    A Paddle subscription is only created when the customer completes
--    Paddle Checkout, so the pending row now stores a server-generated
--    `checkout_token` (returned by /api/billing action=checkout and passed
--    through Paddle.js `customData`) rather than a provider subscription id.
--    The token binds a completed checkout to the Zybble user who started it;
--    the plan itself is always re-derived from the PAID Paddle price id.
--    Preparing a checkout still grants nothing.
--
--    LEGACY: `razorpay_subscription_id` (previously NOT NULL UNIQUE) is kept
--    for historical rows; the NOT NULL is dropped because new rows have no
--    Razorpay id. Its unique constraint becomes a partial unique index.
-- ---------------------------------------------------------------------------
alter table subscription_checkouts alter column razorpay_subscription_id drop not null;

alter table subscription_checkouts add column if not exists billing_provider text;
alter table subscription_checkouts add column if not exists checkout_token text;
alter table subscription_checkouts add column if not exists provider_price_id text;
alter table subscription_checkouts add column if not exists provider_customer_id text;
alter table subscription_checkouts add column if not exists provider_subscription_id text;
alter table subscription_checkouts add column if not exists provider_transaction_id text;

update subscription_checkouts
set billing_provider = 'razorpay'
where razorpay_subscription_id is not null
  and billing_provider is null;

update subscription_checkouts
set billing_provider = 'none'
where billing_provider is null;

alter table subscription_checkouts alter column billing_provider set not null;
alter table subscription_checkouts alter column billing_provider set default 'none';

-- Replace the old column-level UNIQUE on razorpay_subscription_id with a
-- partial unique index so multiple NULLs (all Paddle rows) are allowed.
-- The UNIQUE column constraint in 0006/0001 backs itself with the index
-- `subscription_checkouts_razorpay_subscription_id_key`; drop the constraint
-- (which removes its index), then recreate equivalent coverage partially.
alter table subscription_checkouts
  drop constraint if exists subscription_checkouts_razorpay_subscription_id_key;
drop index if exists subscription_checkouts_razorpay_subscription_id_key;
create unique index if not exists subscription_checkouts_rzp_sub_uidx
  on subscription_checkouts (razorpay_subscription_id)
  where razorpay_subscription_id is not null;

create unique index if not exists subscription_checkouts_token_uidx
  on subscription_checkouts (checkout_token)
  where checkout_token is not null;

create index if not exists subscription_checkouts_user_plan_idx
  on subscription_checkouts (user_id, plan_id, created_at desc);
create index if not exists subscription_checkouts_provider_sub_idx
  on subscription_checkouts (provider_subscription_id);

-- ---------------------------------------------------------------------------
-- 5) Billing currency — USD under Paddle
--
--     Zybble's paid prices are $49 / $99 / $199 per month. The plans table
--     recorded 'INR' only because the legacy provider billed in India; Paddle
--     bills these prices in USD. Historical payment/invoice rows keep the
--     currency they actually recorded (nothing historical is rewritten); only
--     the plan catalog default changes, because plan prices are what NEW
--     checkouts display and what new rows inherit.
-- ---------------------------------------------------------------------------
update plans set currency = 'USD' where currency is distinct from 'USD';

-- ---------------------------------------------------------------------------
-- 6) Quota state RPC — powers the dedicated monthly_lead_limit_reached error
--
--    `reserve_leads()` remains the authoritative, atomic enforcement point.
--    This read-only helper exists so the search API can explain a -2 refusal
--    with the real numbers (plan, allowance, used) instead of a generic error.
--    A workspace member may call it for their own workspace; the plan that
--    governs a workspace is the OWNER's effective plan (same rule as
--    reserve_leads()).
-- ---------------------------------------------------------------------------
create or replace function lead_quota_state(ws uuid)
returns table (plan_id text, allowance integer, used integer)
language sql
security definer stable
set search_path = public
as $$
  select
    workspace_plan(ws) as plan_id,
    coalesce((
      select p.lead_allowance from plans p where p.id = workspace_plan(ws)
    ), 50) as allowance,
    coalesce((
      select uc.leads_used from usage_counters uc
      where uc.workspace_id = ws
        and uc.period_start = date_trunc('month', now())::date
    ), 0) as used;
$$;
revoke execute on function lead_quota_state(uuid) from public, anon;
grant execute on function lead_quota_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Admin console — provider-neutral billing visibility
--
--    0008's functions selected razorpay_* columns directly. They are
--    redefined here to select the provider-neutral columns (falling back to
--    the legacy Razorpay columns for historical rows) so the admin console
--    works for both Paddle and legacy records without changing its API shape.
--    Only the functions that referenced Razorpay columns are redefined.
-- ---------------------------------------------------------------------------

-- 6a) User directory: show provider/billing ids instead of Razorpay ids.
create or replace function admin_user_directory(
  p_search text default null,
  p_plan text default null,
  p_role text default null,
  p_sub_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sort text default null,
  p_dir text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer stable
set search_path = public
as $$
declare
  result jsonb;
  needle text := nullif(btrim(coalesce(p_search, '')), '');
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  off integer := greatest(coalesce(p_offset, 0), 0);
  order_sql text;
  dir_sql text;
begin
  order_sql := case lower(coalesce(p_sort, 'created_at'))
    when 'created_at' then 'created_at'
    when 'name' then 'name'
    when 'email' then 'email'
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
        s.billing_provider,
        s.provider_subscription_id,
        coalesce(s.provider_customer_id, s.razorpay_customer_id) as provider_customer_id,
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

-- 6b) Customer 360 — same shape as 0008, with provider-neutral billing rows.
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
      select jsonb_build_object(
        'id', s.id,
        'plan_id', s.plan_id,
        'status', s.status,
        'billing_provider', s.billing_provider,
        'provider_customer_id', coalesce(s.provider_customer_id, s.razorpay_customer_id),
        'provider_subscription_id', coalesce(s.provider_subscription_id, s.razorpay_subscription_id),
        'provider_price_id', coalesce(s.provider_price_id, s.razorpay_plan_id),
        'provider_transaction_id', s.provider_transaction_id,
        'currency', s.currency,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'cancel_at', s.cancel_at,
        'cancel_at_cycle_end', s.cancel_at_cycle_end,
        'charge_at', s.charge_at,
        'last_event_at', s.last_event_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at
      )
      from subscriptions s where s.user_id = p.id
    ),
    'checkouts', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from (
        select id, plan_id, billing_provider, checkout_token,
               coalesce(provider_subscription_id, razorpay_subscription_id) as provider_subscription_id,
               status, amount_cents, currency, created_at, completed_at
        from subscription_checkouts where user_id = p.id
        order by created_at desc limit 5
      ) c
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(pay) order by pay.created_at desc)
      from (
        select id, billing_provider,
               coalesce(provider_payment_id, razorpay_payment_id) as provider_payment_id,
               coalesce(provider_subscription_id, razorpay_subscription_id) as provider_subscription_id,
               provider_transaction_id,
               amount_cents, currency, status, method, created_at, captured_at
        from payments where user_id = p.id
        order by created_at desc limit 10
      ) pay
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(inv) order by inv.issued_at desc)
      from (
        select id, billing_provider,
               coalesce(provider_invoice_id, razorpay_invoice_id) as provider_invoice_id,
               provider_transaction_id,
               number, description, amount_cents, currency, status, issued_at, period_start, period_end
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

-- 6c) Billing overview: identical shape to 0008 — the only changes are the
--     provider-neutral subscription id (with legacy fallback) and two
--     additive keys (billing_provider, by_provider) for the new era.
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
      ), '{}'::jsonb),
      'by_provider', coalesce((
        select jsonb_object_agg(t.billing_provider, t.c)
        from (select billing_provider, count(*)::int as c from subscriptions group by 1) t
      ), '{}'::jsonb)
    ),
    'revenue', jsonb_build_object(
      'currency', (select coalesce(max(currency), 'USD') from plans),
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
               s.billing_provider,
               coalesce(s.provider_subscription_id, s.razorpay_subscription_id) as provider_subscription_id,
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

-- 6d) Billing records: provider ids resolve to the new columns first and the
--     legacy Razorpay columns second, so both eras are listed and searchable.
create or replace function admin_billing_records(
  p_kind text,
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
      coalesce(pay.provider_payment_id, pay.razorpay_payment_id) as provider_id,
      coalesce(pay.provider_subscription_id, pay.razorpay_subscription_id) as provider_subscription_id,
      pay.provider_transaction_id,
      pay.billing_provider,
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
           or coalesce(pay.provider_payment_id, pay.razorpay_payment_id, '') ilike '%' || (select q from needle) || '%'
           or coalesce(pay.provider_subscription_id, pay.razorpay_subscription_id, '') ilike '%' || (select q from needle) || '%'
           or coalesce(pay.provider_transaction_id, '') ilike '%' || (select q from needle) || '%'
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
      coalesce(inv.provider_invoice_id, inv.razorpay_invoice_id) as provider_id,
      coalesce(inv.provider_subscription_id, inv.razorpay_payment_id) as provider_subscription_id,
      inv.provider_transaction_id,
      inv.billing_provider,
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
           or coalesce(inv.provider_invoice_id, inv.razorpay_invoice_id, '') ilike '%' || (select q from needle) || '%'
           or inv.number ilike '%' || (select q from needle) || '%'
           or coalesce(inv.provider_transaction_id, '') ilike '%' || (select q from needle) || '%'
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
      coalesce(sub.provider_subscription_id, sub.razorpay_subscription_id) as provider_id,
      coalesce(sub.provider_subscription_id, sub.razorpay_subscription_id) as provider_subscription_id,
      null::text as provider_transaction_id,
      sub.billing_provider,
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
           or coalesce(sub.provider_subscription_id, sub.razorpay_subscription_id, '') ilike '%' || (select q from needle) || '%'
           or coalesce(sub.provider_customer_id, sub.razorpay_customer_id, '') ilike '%' || (select q from needle) || '%'
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

-- 6e) Webhook detail: resolve the referenced entities for Paddle payloads
--     (event.data.id / event.data.subscription_id), falling back to the
--     legacy Razorpay payload shape for historical rows.
create or replace function admin_webhook_detail(p_id uuid)
returns jsonb
language sql
security definer stable
set search_path = public
as $$
  with ids as (
    select
      we.id as webhook_row_id,
      nullif(we.payload #>> '{data,id}', '') as entity_id,
      nullif(we.payload #>> '{data,subscription_id}', '') as subscription_id,
      nullif(we.payload #>> '{data,status}', '') as entity_status,
      nullif(we.payload #>> '{data,customer_id}', '') as customer_id,
      nullif(we.payload #>> '{data,totals,total}', '') as amount_minor,
      nullif(we.payload #>> '{data,currency_code}', '') as currency_code,
      -- legacy Razorpay payload shape
      nullif(we.payload #>> '{payload,subscription,entity,id}', '') as legacy_subscription_id,
      nullif(we.payload #>> '{payload,payment,entity,id}', '') as legacy_payment_id,
      nullif(we.payload #>> '{payload,payment,entity,status}', '') as legacy_payment_status,
      nullif(we.payload #>> '{payload,subscription,entity,status}', '') as legacy_subscription_status,
      nullif(we.payload #>> '{payload,payment,entity,amount}', '') as legacy_amount_minor
    from webhook_events we
    where we.id = p_id
  )
  select case when ids.webhook_row_id is null then null else jsonb_build_object(
    'event', (
      select jsonb_build_object(
        'id', we.id,
        'provider', we.provider,
        'event_id', we.event_id,
        'event_type', we.event_type,
        'status', we.status,
        'attempts', we.attempts,
        'received_at', we.received_at,
        'processed_at', we.processed_at,
        'error', we.error,
        'subscription_id', coalesce(ids.subscription_id, ids.legacy_subscription_id),
        'payment_id', coalesce(nullif(we.payload #>> '{data,payments,0,id}', ''), ids.legacy_payment_id),
        'payment_status', ids.legacy_payment_status,
        'subscription_status', coalesce(ids.entity_status, ids.legacy_subscription_status),
        'amount_minor', coalesce(ids.amount_minor, ids.legacy_amount_minor),
        'currency_code', ids.currency_code
      )
      from webhook_events we where we.id = ids.webhook_row_id
    ),
    'subscription', (
      select to_jsonb(s) from subscriptions s
      where s.provider_subscription_id = coalesce(ids.subscription_id, ids.entity_id)
         or s.razorpay_subscription_id = ids.legacy_subscription_id
      limit 1
    ),
    'payment', (
      select to_jsonb(p) from payments p
      where p.provider_transaction_id = coalesce(ids.entity_id, ids.subscription_id)
         or p.razorpay_payment_id = ids.legacy_payment_id
      limit 1
    ),
    'customer', (
      select jsonb_build_object('id', pr.id, 'name', pr.name, 'email', au.email::text)
      from subscriptions s
      join profiles pr on pr.id = s.user_id
      left join auth.users au on au.id = s.user_id
      where s.provider_subscription_id = coalesce(ids.subscription_id, ids.entity_id)
         or s.razorpay_subscription_id = ids.legacy_subscription_id
      limit 1
    )
  ) end
  from ids;
$$;
revoke execute on function admin_webhook_detail(uuid) from public, anon, authenticated;
grant execute on function admin_webhook_detail(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8) PostgREST must re-read the schema so the new RPC/columns are visible
--    immediately after this migration runs.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
