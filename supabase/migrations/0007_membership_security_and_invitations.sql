-- ============================================================================
-- 0007 — membership privilege-escalation repair + a real invitation lifecycle
--
-- Two production defects are fixed here.
--
-- 1) PRIVILEGE ESCALATION (critical).
--    0006 left an `or user_id = auth.uid()` escape hatch on the
--    workspace_members INSERT and UPDATE policies:
--
--      create policy "members owner admin insert" on workspace_members
--      for insert with check (user_id = auth.uid() or can_manage_workspace(workspace_id));
--
--    That clause lets ANY authenticated user insert themselves into ANY
--    workspace with any role — `insert into workspace_members
--    (workspace_id, user_id, role) values ('<someone-elses-workspace>',
--    auth.uid(), 'owner')` — and every lead/list/export/search policy keys off
--    `is_workspace_member()`, so that one row grants complete read/write access
--    to another customer's data. The UPDATE policy has the same shape, letting
--    an ordinary 'member' promote their own row to 'owner'.
--
--    No application code needs it. Every legitimate self-membership is created
--    by a SECURITY DEFINER function, which bypasses RLS by design:
--      handle_new_user()             — signup trigger
--      ensure_personal_workspace()   — owner self-heal
--      create_client_workspace()     — Agency/Scale client workspace
--      accept_invitation()           — invited teammate (below)
--    The policies are therefore narrowed to "a manager of this workspace".
--
-- 2) INVITATIONS COULD NEVER BE ACCEPTED.
--    `accept_invitation()` shipped in 0001 but nothing ever called it, and the
--    invitee-facing policies could not work: "invitations invitee update" has
--    `with check (status = 'pending')`, which blocks the very transition it
--    exists for, and "invitations invitee read" subselects `auth.users`, which
--    the `authenticated` role cannot read. Invited users signed up, landed in
--    their own personal workspace, and the invitation stayed `pending` forever
--    while still consuming a paid seat.
--
--    Invitees now go through two SECURITY DEFINER RPCs that authorize on the
--    caller's verified email: list_my_invitations() and decline_invitation().
--    accept_invitation() is hardened (email confirmed, stale state, seat limit)
--    and returns a clear error code the UI maps to a human message.
--
-- Idempotent and safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) workspace_members — managers only
-- ---------------------------------------------------------------------------
drop policy if exists "members owner admin insert" on workspace_members;
create policy "members owner admin insert" on workspace_members
for insert with check (can_manage_workspace(workspace_id));

drop policy if exists "members owner admin update" on workspace_members;
create policy "members owner admin update" on workspace_members
for update using (can_manage_workspace(workspace_id))
with check (can_manage_workspace(workspace_id));

-- Leaving a workspace yourself stays allowed; the owner's own row does not,
-- because a workspace without its owner as a member is the exact orphan state
-- migration 0006 had to repair.
drop policy if exists "members remove or self remove" on workspace_members;
create policy "members remove or self remove" on workspace_members
for delete using (
  (user_id = auth.uid() or can_manage_workspace(workspace_id))
  and not exists (
    select 1 from workspaces w
    where w.id = workspace_members.workspace_id and w.owner_id = workspace_members.user_id
  )
);

-- A manager may change a teammate's role, but the owner's role is not a
-- settable field: demoting it would strip the workspace of its owner seat.
create or replace function protect_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from workspaces w
    where w.id = new.workspace_id and w.owner_id = new.user_id
  ) and new.role <> 'owner' then
    raise exception 'owner_role_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_members_protect_owner on workspace_members;
create trigger workspace_members_protect_owner before update on workspace_members
for each row execute function protect_owner_membership();

-- ---------------------------------------------------------------------------
-- 2) Invitations — the invitee side is RPC-only
-- ---------------------------------------------------------------------------
-- This policy could never be satisfied (`with check (status = 'pending')`
-- rejects accept and decline alike) and reads auth.users from a policy
-- expression. Acceptance/decline run through the definer RPCs below instead.
drop policy if exists "invitations invitee update" on workspace_invitations;
drop policy if exists "invitations invitee read" on workspace_invitations;

/** Pending invitations addressed to the signed-in user's verified email. */
create or replace function list_my_invitations()
returns table (
  id uuid,
  workspace_id uuid,
  workspace_name text,
  role text,
  invited_by text,
  created_at timestamptz
)
language plpgsql
security definer stable
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
begin
  if caller is null then
    raise exception 'not_authenticated';
  end if;
  select lower(u.email) into caller_email from auth.users u where u.id = caller;
  if caller_email is null then
    return;
  end if;

  return query
  select
    i.id,
    i.workspace_id,
    coalesce(w.name, 'Workspace') as workspace_name,
    i.role,
    coalesce(nullif(btrim(p.name), ''), split_part(au.email, '@', 1), 'A teammate') as invited_by,
    i.created_at
  from workspace_invitations i
  join workspaces w on w.id = i.workspace_id
  left join profiles p on p.id = i.inviter_id
  left join auth.users au on au.id = i.inviter_id
  where i.status = 'pending'
    and lower(i.email) = caller_email
    -- Already a member: the invitation is stale, never offer it again.
    and not exists (
      select 1 from workspace_members m
      where m.workspace_id = i.workspace_id and m.user_id = caller
    )
  order by i.created_at asc;
end;
$$;
revoke execute on function list_my_invitations() from public, anon;
grant execute on function list_my_invitations() to authenticated;

/**
 * Accept an invitation addressed to the caller's own verified email.
 *
 * Idempotent: accepting twice (double-click, two tabs, a replayed link)
 * returns the same workspace id instead of failing, and the seat limit is
 * reported as a distinct, actionable error rather than a raw trigger message.
 */
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
  already boolean;
  seats integer;
  used integer;
begin
  if caller is null then
    raise exception 'not_authenticated';
  end if;

  -- Serialize concurrent acceptances of the same invitation so two tabs
  -- cannot both pass the seat check.
  select * into inv from workspace_invitations where id = invitation_id for update;
  if not found then raise exception 'invitation_not_found'; end if;

  select lower(u.email) into caller_email from auth.users u where u.id = caller;
  if caller_email is null or caller_email <> lower(inv.email) then
    raise exception 'invitation_email_mismatch';
  end if;

  select exists (
    select 1 from workspace_members m
    where m.workspace_id = inv.workspace_id and m.user_id = caller
  ) into already;

  if already then
    update workspace_invitations set status = 'accepted' where id = invitation_id;
    return inv.workspace_id;
  end if;

  if inv.status <> 'pending' then raise exception 'invitation_not_pending'; end if;

  select pl.max_users into seats from plans pl where pl.id = workspace_plan(inv.workspace_id);
  seats := coalesce(seats, 1);
  select count(*) into used from workspace_members m where m.workspace_id = inv.workspace_id;
  if used >= seats then
    raise exception 'seat_limit_reached';
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, caller, inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update workspace_invitations set status = 'accepted' where id = invitation_id;
  return inv.workspace_id;
end;
$$;
revoke execute on function accept_invitation(uuid) from public, anon;
grant execute on function accept_invitation(uuid) to authenticated;

/** Decline an invitation addressed to the caller's own verified email. */
create or replace function decline_invitation(invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inv workspace_invitations%rowtype;
  caller uuid := auth.uid();
  caller_email text;
begin
  if caller is null then
    raise exception 'not_authenticated';
  end if;

  select * into inv from workspace_invitations where id = invitation_id for update;
  if not found then raise exception 'invitation_not_found'; end if;

  select lower(u.email) into caller_email from auth.users u where u.id = caller;
  if caller_email is null or caller_email <> lower(inv.email) then
    raise exception 'invitation_email_mismatch';
  end if;

  -- Idempotent: declining an already-declined invitation is a no-op success.
  if inv.status = 'pending' then
    update workspace_invitations set status = 'declined' where id = invitation_id;
  end if;
  return true;
end;
$$;
revoke execute on function decline_invitation(uuid) from public, anon;
grant execute on function decline_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Housekeeping: an invitation for somebody who is already a member holds a
--    paid seat for nothing. Mark those accepted once, now.
-- ---------------------------------------------------------------------------
update workspace_invitations i
set status = 'accepted'
where i.status = 'pending'
  and exists (
    select 1
    from workspace_members m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = i.workspace_id
      and lower(u.email) = lower(i.email)
  );
