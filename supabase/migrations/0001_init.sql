-- ============================================================================
-- Zybble — production schema, RLS, triggers, and security-definer helpers
-- Run inside the Supabase SQL Editor (or `supabase db push`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions / helpers
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plans & entitlements (source of truth for limits)
-- ---------------------------------------------------------------------------
create table if not exists plans (
  id text primary key, -- free | growth | agency | scale
  price_cents integer not null,
  lead_allowance integer not null,
  max_lists integer not null, -- -1 = unlimited
  max_users integer not null,
  has_ai boolean not null,
  client_workspaces boolean not null,
  priority_processing boolean not null
);

insert into plans (id, price_cents, lead_allowance, max_lists, max_users, has_ai, client_workspaces, priority_processing)
values
  ('free',   0,     50,     1,  1, true,  false, false),
  ('growth', 4900,  5000,  -1,  1, true,  false, false),
  ('agency', 9900,  15000, -1,  3, true,  true,  false),
  ('scale',  19900, 50000, -1,  5, true,  true,  true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  avatar_url text,
  role text not null default 'user' check (role in ('user','admin')),
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on profiles
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Workspaces / membership / invitations
-- ---------------------------------------------------------------------------
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null default 'free' references plans (id),
  is_client boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspaces_owner_idx on workspaces (owner_id);

create trigger workspaces_updated_at before update on workspaces
for each row execute function set_updated_at();

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on workspace_members (user_id);

create table if not exists workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  inviter_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

-- ---------------------------------------------------------------------------
-- RLS helper functions (security definer to avoid policy recursion)
-- ---------------------------------------------------------------------------
create or replace function is_workspace_member(ws uuid)
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

create or replace function has_workspace_role(ws uuid, roles text[])
returns boolean
language sql
security definer stable
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = any(roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Auto-provision: profile + personal workspace on signup
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  display_name text;
begin
  display_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1));

  insert into profiles (id, name) values (new.id, display_name);

  insert into workspaces (name, owner_id, plan_id, is_client)
  values (display_name || '''s workspace', new.id, 'free', false)
  returning id into ws_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Subscriptions / payments / invoices
-- ---------------------------------------------------------------------------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null default 'free' references plans (id),
  status text not null default 'active' check (status in ('active','trialing','past_due','cancelled','paused','failed')),
  razorpay_customer_id text,
  razorpay_subscription_id text unique,
  razorpay_plan_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);
create index if not exists subscriptions_user_idx on subscriptions (user_id);

create trigger subscriptions_updated_at before update on subscriptions
for each row execute function set_updated_at();

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  subscription_id uuid references subscriptions (id) on delete set null,
  razorpay_payment_id text unique,
  razorpay_subscription_id text,
  amount_cents integer not null,
  currency text not null default 'USD',
  status text not null default 'captured',
  event_id text,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references subscriptions (id) on delete set null,
  number text not null,
  description text not null,
  amount_cents integer not null,
  currency text not null default 'USD',
  status text not null default 'paid' check (status in ('paid','failed','upcoming','refunded')),
  razorpay_invoice_id text,
  issued_at timestamptz not null default now()
);

create table if not exists subscription_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  razorpay_event_id text,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lead engine: searches, jobs, leads, lists, exports
-- ---------------------------------------------------------------------------
create table if not exists lead_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  query text not null,
  interpretation jsonb,
  filters jsonb not null default '{}'::jsonb,
  location text,
  requested_count integer not null default 50,
  result_count integer not null default 0,
  status text not null default 'processing'
    check (status in ('queued','processing','fetching','normalizing','deduplicating','saving','completed','partial','failed','cancelled')),
  error text,
  saved_list_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists lead_searches_ws_idx on lead_searches (workspace_id, created_at desc);

create table if not exists lead_search_jobs (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references lead_searches (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','fetching','normalizing','deduplicating','saving','completed','failed','cancelled')),
  requested_count integer not null,
  processed_count integer not null default 0,
  current_stage text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lead_search_jobs_search_idx on lead_search_jobs (search_id);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  search_id uuid references lead_searches (id) on delete set null,
  collector_id uuid references auth.users (id) on delete set null,

  -- identity
  name text not null,
  title text,
  place_id text,
  data_id text,
  data_cid text,
  kgmid text,

  -- classification
  category text,
  categories text[] not null default '{}',
  types text[] not null default '{}',
  description text,

  -- reputation
  rating numeric(2,1),
  reviews integer,

  -- pricing
  price text,
  price_level integer,

  -- contact
  phone text,
  phone_normalized text,
  email text,
  emails text[] not null default '{}',
  website text,
  website_domain text,

  -- location
  address text,
  street text,
  city text,
  state text,
  postal_code text,
  country text,
  country_code text,
  latitude double precision,
  longitude double precision,
  plus_code text,

  -- hours & operations
  hours jsonb not null default '{}'::jsonb,
  open_state text not null default 'unknown' check (open_state in ('open','closed','unknown')),
  hours_display text,

  -- features
  services text[] not null default '{}',
  service_options text[] not null default '{}',
  amenities text[] not null default '{}',
  attributes text[] not null default '{}',

  -- media / links
  photos integer not null default 0,
  thumbnail text,
  logo text,
  maps_url text,
  google_maps_url text,
  booking_links text[] not null default '{}',
  menu_links text[] not null default '{}',
  social_links text[] not null default '{}',

  -- source
  source text,
  source_url text,

  -- ownership
  owner_name text,
  owner_link text,

  -- context
  search_query text,
  search_location text,

  -- provider
  provider text not null default 'serpapi',
  provider_version text,
  raw_data jsonb,

  -- workflow
  status text not null default 'new' check (status in ('new','enriched','contacted')),
  tags text[] not null default '{}',

  -- dedupe
  dedupe_key text not null,

  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (workspace_id, dedupe_key)
);
create index if not exists leads_ws_idx on leads (workspace_id, created_at desc);
create index if not exists leads_search_idx on leads (search_id);
create index if not exists leads_place_idx on leads (place_id);
create index if not exists leads_data_id_idx on leads (data_id);
create index if not exists leads_data_cid_idx on leads (data_cid);
create index if not exists leads_domain_idx on leads (website_domain);
create index if not exists leads_phone_idx on leads (phone_normalized);
create index if not exists leads_city_idx on leads (workspace_id, city);

create trigger leads_updated_at before update on leads
for each row execute function set_updated_at();

create table if not exists lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists lead_notes_lead_idx on lead_notes (lead_id);

create table if not exists lead_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_lists_ws_idx on lead_lists (workspace_id, created_at desc);

create trigger lead_lists_updated_at before update on lead_lists
for each row execute function set_updated_at();

create table if not exists lead_list_members (
  list_id uuid not null references lead_lists (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);
create index if not exists lead_list_members_lead_idx on lead_list_members (lead_id);

create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null,
  source text not null,
  lead_count integer not null default 0,
  format text not null default 'csv' check (format in ('csv')),
  status text not null default 'preparing' check (status in ('preparing','processing','completed','failed')),
  csv text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists exports_ws_idx on exports (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- AI
-- ---------------------------------------------------------------------------
create table if not exists ai_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('interpret','analyze','suggest','summary')),
  input jsonb not null,
  status text not null default 'completed' check (status in ('processing','completed','failed')),
  model text,
  tokens integer,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists ai_insights (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'lead',
  summary text not null,
  points text[] not null default '{}',
  model text,
  created_at timestamptz not null default now(),
  unique (lead_id)
);

-- ---------------------------------------------------------------------------
-- Usage
-- ---------------------------------------------------------------------------
create table if not exists usage_counters (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  period_start date not null,
  leads_used integer not null default 0,
  searches integer not null default 0,
  exports integer not null default 0,
  ai_runs integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, period_start)
);

-- ---------------------------------------------------------------------------
-- Activity / audit log
-- ---------------------------------------------------------------------------
create table if not exists activity_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid references workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null,
  text text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_ws_idx on activity_logs (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Webhook events (idempotency)
-- ---------------------------------------------------------------------------
create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received','processed','failed')),
  error text
);

-- ---------------------------------------------------------------------------
-- Atomic usage reservation (prevents concurrent over-consumption)
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
  -- determine the plan allowance from the workspace's subscription
  select p.lead_allowance into allowance
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.user_id = (select owner_id from workspaces where id = ws)
    and s.status in ('active','trialing')
  limit 1;

  if allowance is null then
    select lead_allowance into allowance from plans where id = 'free';
  end if;

  -- authorize: only a member or the service provisioning may request this
  if caller is not null and not is_workspace_member(ws) then
    return -1;
  end if;

  insert into usage_counters (workspace_id, period_start, leads_used, searches)
  values (ws, p_start, 0, 0)
  on conflict (workspace_id, period_start) do nothing;

  update usage_counters
  set leads_used = leads_used + delta,
      searches = searches + 1,
      updated_at = now()
  where workspace_id = ws
    and period_start = p_start
    and leads_used + delta <= allowance
  returning leads_used into new_used;

  if new_used is null then
    return -2; -- over allowance
  end if;
  return allowance - new_used;
end;
$$;

-- ---------------------------------------------------------------------------
-- Limits enforced at the database layer
-- ---------------------------------------------------------------------------

-- Free plan: one list per workspace; unlimited otherwise
create or replace function enforce_list_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_lists integer;
  current_lists integer;
  ws_plan text;
begin
  select coalesce(s.plan_id, 'free') into ws_plan
  from subscriptions s
  where s.user_id = (select owner_id from workspaces where id = new.workspace_id)
  limit 1;

  ws_plan := coalesce(ws_plan, 'free');
  select p.max_lists into max_lists from plans p where p.id = ws_plan;

  if max_lists >= 0 then
    select count(*) into current_lists from lead_lists where workspace_id = new.workspace_id;
    if current_lists >= max_lists then
      raise exception 'list_limit_reached';
    end if;
  end if;
  return new;
end;
$$;

create trigger lead_lists_limit before insert on lead_lists
for each row execute function enforce_list_limit();

-- Plan seat limits on workspace membership
create or replace function enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_users integer;
  current_users integer;
  ws_plan text;
begin
  select coalesce(s.plan_id, 'free') into ws_plan
  from subscriptions s
  where s.user_id = (select owner_id from workspaces where id = new.workspace_id)
  limit 1;

  ws_plan := coalesce(ws_plan, 'free');
  select p.max_users into max_users from plans p where p.id = ws_plan;

  select count(*) into current_users from workspace_members where workspace_id = new.workspace_id;
  if current_users >= max_users then
    raise exception 'seat_limit_reached';
  end if;
  return new;
end;
$$;

create trigger workspace_members_seat_limit before insert on workspace_members
for each row execute function enforce_seat_limit();

-- Client workspaces require agency/scale
create or replace function enforce_client_workspace_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_plan text;
begin
  if new.is_client then
    select coalesce(s.plan_id,'free') into owner_plan
    from subscriptions s
    where s.user_id = new.owner_id
    limit 1;

    owner_plan := coalesce(owner_plan, 'free');
    if owner_plan not in ('agency','scale') then
      raise exception 'client_workspaces_not_available';
    end if;
  end if;
  return new;
end;
$$;

create trigger workspaces_client_plan before insert on workspaces
for each row execute function enforce_client_workspace_plan();

-- ---------------------------------------------------------------------------
-- Security-definer RPC: accept a workspace invitation
-- ---------------------------------------------------------------------------
create or replace function accept_invitation(invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv workspace_invitations%rowtype;
  caller uuid := auth.uid();
  caller_email text;
begin
  select * into inv from workspace_invitations where id = invitation_id;
  if not found then raise exception 'invitation_not_found'; end if;
  if inv.status <> 'pending' then raise exception 'invitation_not_pending'; end if;

  select email into caller_email from auth.users where id = caller;
  if lower(caller_email) <> lower(inv.email) then
    raise exception 'invitation_email_mismatch';
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, caller, inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update workspace_invitations set status = 'accepted' where id = invitation_id;
  return inv.workspace_id;
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table workspace_invitations enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table invoices enable row level security;
alter table subscription_events enable row level security;
alter table lead_searches enable row level security;
alter table lead_search_jobs enable row level security;
alter table leads enable row level security;
alter table lead_notes enable row level security;
alter table lead_lists enable row level security;
alter table lead_list_members enable row level security;
alter table exports enable row level security;
alter table ai_requests enable row level security;
alter table ai_insights enable row level security;
alter table usage_counters enable row level security;
alter table activity_logs enable row level security;
alter table webhook_events enable row level security;
alter table plans enable row level security;

-- Non-recursive admin predicate. Never query profiles directly from a policy
-- on profiles: PostgreSQL rejects that with "infinite recursion detected".
create or replace function is_zybble_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin');
$$;
revoke execute on function is_zybble_admin() from public, anon;
grant execute on function is_zybble_admin() to authenticated;

create or replace function protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not is_zybble_admin() then
    raise exception 'Only an administrator can change profile roles';
  end if;
  return new;
end;
$$;
create trigger profiles_protect_role before update on profiles
for each row execute function protect_profile_role();

-- plans: readable by everyone (needed for pricing), write blocked
create policy "plans read" on plans for select using (true);

-- profiles: users can read/update their own; admins read all
create policy "profiles self read" on profiles for select using (auth.uid() = id or is_zybble_admin());
create policy "profiles self update" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles self insert" on profiles for insert with check (auth.uid() = id and role = 'user');

-- workspaces: members can read; owner/admin can update; inserts allowed (DB trigger enforces plan limits)
create policy "workspaces member read" on workspaces for select using (is_workspace_member(id));
create policy "workspaces insert" on workspaces for insert with check (owner_id = auth.uid());
create policy "workspaces owner admin update" on workspaces for update using (has_workspace_role(id, '{owner,admin}')) with check (has_workspace_role(id, '{owner,admin}'));
create policy "workspaces owner delete" on workspaces for delete using (owner_id = auth.uid());

-- workspace_members: members can read each other; owner/admins manage; self-join via invitation RPC
create policy "members member read" on workspace_members for select using (is_workspace_member(workspace_id) or user_id = auth.uid());
create policy "members owner admin insert" on workspace_members for insert with check (has_workspace_role(workspace_id, '{owner,admin}') or user_id = auth.uid());
create policy "members owner admin update" on workspace_members for update using (has_workspace_role(workspace_id, '{owner,admin}') or user_id = auth.uid());
create policy "members remove or self remove" on workspace_members for delete using (has_workspace_role(workspace_id, '{owner,admin}') or user_id = auth.uid());

-- invitations: owner/admin of the workspace manage; invitee can read their own
create policy "invitations manager read write" on workspace_invitations for all using (has_workspace_role(workspace_id, '{owner,admin}') or inviter_id = auth.uid())
  with check (has_workspace_role(workspace_id, '{owner,admin}') or inviter_id = auth.uid());
create policy "invitations invitee read" on workspace_invitations for select using (
  lower(email) = lower((select email from auth.users where id = auth.uid()))
);
create policy "invitations invitee update" on workspace_invitations for update using (
  lower(email) = lower((select email from auth.users where id = auth.uid()))
) with check (status = 'pending');

-- subscriptions / payments / invoices: only the owner can read; service role manages
create policy "subscriptions owner read" on subscriptions for select using (user_id = auth.uid());
create policy "payments owner read" on payments for select using (user_id = auth.uid());
create policy "invoices owner read" on invoices for select using (user_id = auth.uid());

-- subscription_events / webhook_events: no user access (service role only)
create policy "subscription events service only" on subscription_events for all using (false);
create policy "webhook events service only" on webhook_events for all using (false);

-- lead data: workspace members of any role can read and manage their workspace's data
create policy "searches member all" on lead_searches for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "search jobs member read" on lead_search_jobs for select using (is_workspace_member(workspace_id));
create policy "search jobs member update" on lead_search_jobs for update using (is_workspace_member(workspace_id));

create policy "leads member all" on leads for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "notes member all" on lead_notes for all using (exists (select 1 from leads l where l.id = lead_id and is_workspace_member(l.workspace_id)));
create policy "lists member all" on lead_lists for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "list members workspace check" on lead_list_members for all using (
  exists (select 1 from lead_lists ll where ll.id = list_id and is_workspace_member(ll.workspace_id))
) with check (
  exists (select 1 from lead_lists ll where ll.id = list_id and is_workspace_member(ll.workspace_id))
  and exists (select 1 from leads l where l.id = lead_id and is_workspace_member(l.workspace_id))
);
create policy "exports member all" on exports for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy "ai requests member all" on ai_requests for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "ai insights member all" on ai_insights for all using (exists (select 1 from leads l where l.id = lead_id and is_workspace_member(l.workspace_id)));

create policy "usage member read" on usage_counters for select using (is_workspace_member(workspace_id));
create policy "activity member read" on activity_logs for select using (is_workspace_member(workspace_id));

-- admins can read anything for support/ops (non-recursive helper above)
create policy "admin read workspaces" on workspaces for select using (is_zybble_admin());
create policy "admin read members" on workspace_members for select using (is_zybble_admin());
create policy "admin read subscriptions" on subscriptions for select using (is_zybble_admin());
create policy "admin read leads" on leads for select using (is_zybble_admin());
create policy "admin read searches" on lead_searches for select using (is_zybble_admin());
create policy "admin read usage" on usage_counters for select using (is_zybble_admin());
create policy "admin read webhooks" on webhook_events for select using (is_zybble_admin());

-- ============================================================================
-- Seed a sensible lookup row (idempotent)
-- ============================================================================
insert into plans (id, price_cents, lead_allowance, max_lists, max_users, has_ai, client_workspaces, priority_processing)
values
  ('free', 0, 50, 1, 1, true, false, false),
  ('growth', 4900, 5000, -1, 1, true, false, false),
  ('agency', 9900, 15000, -1, 3, true, true, false),
  ('scale', 19900, 50000, -1, 5, true, true, true)
on conflict (id) do update set
  lead_allowance = excluded.lead_allowance,
  max_lists = excluded.max_lists,
  max_users = excluded.max_users,
  has_ai = excluded.has_ai,
  client_workspaces = excluded.client_workspaces,
  priority_processing = excluded.priority_processing;
