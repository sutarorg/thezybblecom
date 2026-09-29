/* ------------------------------------------------------------------ */
/* Zybble app — Team                                                   */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Crown, Mail, MoreHorizontal, Shield, UserMinus, UserPlus, Users } from "lucide-react";
import { cn } from "../../utils/cn";
import { AppLayout } from "../components/AppLayout";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  Dialog,
  DialogHeader,
  EmptyState,
  FieldLabel,
  IconBtn,
  Input,
  MetaText,
  PopItem,
  PopSep,
  Popover,
  TableSkeleton,
  formatDate,
  relative,
  useToast,
} from "../components/ui";
import { planFromId } from "../data/plans";
import type { Role, TeamMember } from "../data/types";
import { useAppSeo } from "../hooks";
import { getTeam, inviteMember, removeMember } from "../services/api";
import { useWorkspaceContext } from "../services/hooks";

const ROLE_META: Record<Role, { icon: React.ElementType; label: string }> = {
  owner: { icon: Crown, label: "Owner" },
  admin: { icon: Shield, label: "Admin" },
  member: { icon: Users, label: "Member" },
};

export function TeamPage() {
  useAppSeo("Team — Zybble", "People who can work this workspace's leads.", "/team");
  const toast = useToast();
  const { workspace, planId, loading: ctxLoading } = useWorkspaceContext();
  const plan = planFromId(planId);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [sending, setSending] = useState(false);
  const [toRemove, setToRemove] = useState<TeamMember | null>(null);

  const load = useCallback(() => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    getTeam(workspace.id)
      .then(setMembers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    if (!ctxLoading && !workspace) setLoading(false);
    load();
  }, [load, ctxLoading, workspace]);

  const active = members.filter((m) => m.status === "active").length;
  const pending = members.length - active;
  const atSeatLimit = active >= plan.maxUsers;
  const busy = loading || ctxLoading;

  const onInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !workspace) return;
    setSending(true);
    const { error: inviteError, ok } = await inviteMember(
      workspace.id,
      email,
      role === "admin" ? "admin" : "member"
    );
    setSending(false);
    if (inviteError) {
      toast(inviteError, "error");
      return;
    }
    if (ok) {
      setEmail("");
      setInviteOpen(false);
      toast(`Invitation sent to ${email}`);
      load();
    }
  };

  return (
    <AppLayout
      title="Team"
      description="People who can search, save, and work leads in this workspace."
      aside={
        <>
          {!busy ? (
            <Badge tone="neutral">
              {active} active{pending ? ` · ${pending} invited` : ""}
            </Badge>
          ) : null}
          <Btn
            variant="primary"
            onClick={() => {
              if (atSeatLimit) {
                toast(
                  `Your ${plan.label} plan includes ${plan.maxUsers} ${plan.maxUsers === 1 ? "seat" : "seats"}.`,
                  "error"
                );
                return;
              }
              setInviteOpen(true);
            }}
          >
            <UserPlus className="size-3.5" aria-hidden="true" />
            Invite member
          </Btn>
        </>
      }
      wide
    >
      <Card className="mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid size-8 place-items-center rounded-md bg-brand-50 text-brand-700">
          <Users className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">
            {plan.label} plan · {plan.maxUsers} {plan.maxUsers === 1 ? "seat" : "seats"} included
          </p>
          <p className="text-[11px] text-ink-mute">
            {busy ? "Checking seats…" : `You're using ${active} of ${plan.maxUsers}.`}
          </p>
        </div>
        <Btn variant="outline" size="sm" href="/billing">
          Manage plan
        </Btn>
      </Card>

      {error ? (
        <Card className="mb-3 p-4">
          <p className="text-[13px] font-medium text-ink">We couldn't load your team</p>
          <p className="mt-0.5 text-xs leading-5 text-ink-mute">{error}</p>
          <Btn variant="outline" size="sm" className="mt-3" onClick={load}>
            Try again
          </Btn>
        </Card>
      ) : null}

      {busy ? (
        <div className="rounded-lg border border-black/[0.06] bg-white">
          <TableSkeleton rows={3} cols={5} />
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          icon={<Users className="size-4" aria-hidden="true" />}
          title="No team members yet"
          description="Invite colleagues so searches, lists, and workspaces stay in one place."
          action={
            <Btn variant="primary" onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-3.5" aria-hidden="true" />
              Invite member
            </Btn>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-black/[0.06] bg-neutral-50/50">
                  {["Member", "Role", "Workspace", "Status", "Joined", ""].map((h, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="py-2 pl-3 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const RoleIcon = ROLE_META[member.role].icon;
                  return (
                    <tr
                      key={member.id}
                      className="group border-b border-black/[0.04] transition-colors last:border-0 hover:bg-neutral-50/70"
                    >
                      <td className="max-w-[280px] py-2 pl-3 pr-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={member.name} tint={member.tint} />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-ink">{member.name}</span>
                            {member.email ? (
                              <span className="block truncate text-[11px] text-ink-mute">{member.email}</span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                          <RoleIcon className="size-3 text-neutral-400" aria-hidden="true" />
                          {ROLE_META[member.role].label}
                        </span>
                      </td>
                      <td className="max-w-[200px] py-2 pl-3 pr-3">
                        <span className="block truncate text-xs text-ink-soft">{member.workspace}</span>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        <Badge tone={member.status === "active" ? "green" : "amber"}>
                          {member.status === "active" ? "Active" : "Invited"}
                        </Badge>
                      </td>
                      <td className="py-2 pl-3 pr-3">
                        <MetaText>
                          {member.status === "active" ? formatDate(member.joined_at) : relative(member.joined_at)}
                        </MetaText>
                      </td>
                      <td className="py-2 pl-3 pr-2">
                        {member.role !== "owner" ? (
                          <Popover
                            align="end"
                            width="w-44"
                            trigger={(_, toggle) => (
                              <IconBtn
                                variant="ghost"
                                label={`Actions for ${member.name}`}
                                onClick={toggle}
                                className="opacity-60 group-hover:opacity-100"
                              >
                                <MoreHorizontal className="size-3.5" aria-hidden="true" />
                              </IconBtn>
                            )}
                          >
                            <PopSep />
                            <PopItem
                              danger
                              icon={<UserMinus className="size-3.5" aria-hidden="true" />}
                              onClick={() => setToRemove(member)}
                            >
                              {member.status === "invited" ? "Cancel invitation" : "Remove member"}
                            </PopItem>
                          </Popover>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} label="Invite a team member">
        <DialogHeader
          title={`Invite to ${workspace?.name ?? "your workspace"}`}
          description="They'll get access to searches, lists, and shared workspaces."
          onClose={() => setInviteOpen(false)}
        />
        <form onSubmit={onInvite} className="px-4 py-4">
          <div>
            <FieldLabel htmlFor="invite-email">Work email</FieldLabel>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-300"
                aria-hidden="true"
              />
              <Input
                id="invite-email"
                type="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="pl-8"
              />
            </div>
          </div>
          <div className="mt-3">
            <FieldLabel>Role</FieldLabel>
            <div className="flex gap-1 rounded-md border border-black/[0.08] p-1">
              {(["member", "admin"] as Role[]).map((r) => {
                const Icon = ROLE_META[r].icon;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    aria-pressed={role === r}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors",
                      role === r ? "bg-black/[0.05] font-medium text-ink" : "text-ink-soft hover:text-ink"
                    )}
                  >
                    <Icon className="size-3" aria-hidden="true" />
                    {ROLE_META[r].label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-1.5">
            <Btn variant="outline" size="sm" onClick={() => setInviteOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" size="sm" type="submit" disabled={sending}>
              {sending ? "Sending…" : "Send invite"}
            </Btn>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toRemove)}
        onClose={() => setToRemove(null)}
        onConfirm={async () => {
          if (!toRemove || !workspace) return;
          try {
            await removeMember(workspace.id, toRemove.id, toRemove.status);
            setMembers((m) => m.filter((x) => x.id !== toRemove.id));
            toast(toRemove.status === "invited" ? "Invitation cancelled" : "Member removed");
          } catch (e) {
            toast((e as Error).message, "error");
          }
          setToRemove(null);
        }}
        title={toRemove?.status === "invited" ? "Cancel this invitation?" : "Remove this member?"}
        description={
          toRemove?.status === "invited"
            ? `The invitation to ${toRemove?.email} will be withdrawn.`
            : `${toRemove?.name} will immediately lose access to this workspace.`
        }
        confirmLabel={toRemove?.status === "invited" ? "Cancel invite" : "Remove"}
      />
    </AppLayout>
  );
}
