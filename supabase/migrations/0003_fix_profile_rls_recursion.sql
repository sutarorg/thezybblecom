-- ============================================================================
-- Zybble — 0003: remove recursive profile RLS and lock down profile roles.
--
-- The original "profiles self read" policy queried profiles from a policy on
-- profiles. PostgreSQL correctly rejected every authenticated profile read
-- with: infinite recursion detected in policy for relation "profiles".
-- Admin policies on other tables had the same indirect dependency. A small
-- SECURITY DEFINER predicate performs the role lookup without re-entering RLS.
-- Safe to run repeatedly.
-- ============================================================================

create or replace function is_zybble_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke execute on function is_zybble_admin() from public, anon;
grant execute on function is_zybble_admin() to authenticated;

-- A normal user may edit their own profile, but must never be able to promote
-- themselves by including role='admin' in that update.
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

drop trigger if exists profiles_protect_role on profiles;
create trigger profiles_protect_role
before update on profiles
for each row execute function protect_profile_role();

-- Replace the recursive profile read policy. Self reads need no subquery;
-- admin reads go through the non-recursive security-definer predicate.
drop policy if exists "profiles self read" on profiles;
create policy "profiles self read"
on profiles for select
using (auth.uid() = id or is_zybble_admin());

-- Do not permit a client-created profile to choose the admin role.
drop policy if exists "profiles self insert" on profiles;
create policy "profiles self insert"
on profiles for insert
with check (auth.uid() = id and role = 'user');

-- Replace every direct profile lookup in admin policies. Besides avoiding the
-- recursive policy, this keeps one audited definition of "admin".
drop policy if exists "admin read workspaces" on workspaces;
create policy "admin read workspaces" on workspaces for select using (is_zybble_admin());

drop policy if exists "admin read members" on workspace_members;
create policy "admin read members" on workspace_members for select using (is_zybble_admin());

drop policy if exists "admin read subscriptions" on subscriptions;
create policy "admin read subscriptions" on subscriptions for select using (is_zybble_admin());

drop policy if exists "admin read leads" on leads;
create policy "admin read leads" on leads for select using (is_zybble_admin());

drop policy if exists "admin read searches" on lead_searches;
create policy "admin read searches" on lead_searches for select using (is_zybble_admin());

drop policy if exists "admin read usage" on usage_counters;
create policy "admin read usage" on usage_counters for select using (is_zybble_admin());

drop policy if exists "admin read webhooks" on webhook_events;
create policy "admin read webhooks" on webhook_events for select using (is_zybble_admin());

-- Keep AI enabled server-side for Free accounts even if 0002 was not applied
-- successfully before this repair migration.
update plans set has_ai = true where id = 'free';
