/* ------------------------------------------------------------------ */
/* Zybble app — invitations addressed to the signed-in user.           */
/*                                                                     */
/* /api/team-invite creates the invitation and emails a link to        */
/* /signup?invite=…, but until this component there was nowhere in the */
/* product to actually accept one: the invited person signed up,       */
/* landed in their own personal workspace, and the invitation stayed   */
/* `pending` forever while still holding one of the inviter's paid     */
/* seats. Accepting calls the accept_invitation() SECURITY DEFINER RPC */
/* (which re-verifies the caller's email server-side), then refreshes  */
/* the workspace switcher so the new workspace is immediately usable.  */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { Badge, Btn, Card, useToast } from "./ui";
import {
  acceptInvitation,
  declineInvitation,
  listMyInvitations,
  type ReceivedInvitation,
} from "../services/api";

export function PendingInvitations({ onAccepted }: { onAccepted?: () => void } = {}) {
  const toast = useToast();
  const [invitations, setInvitations] = useState<ReceivedInvitation[]>([]);
  /* Per-invitation so one slow accept can't disable the other rows, and so a
     double-click can never fire the RPC twice. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    listMyInvitations()
      .then((rows) => {
        if (!cancelled) setInvitations(rows);
      })
      /* A failure here must never break the page it is embedded in — the
         invitation banner is additive, not load-bearing. */
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const respond = async (invitation: ReceivedInvitation, accept: boolean) => {
    if (busyId) return;
    setBusyId(invitation.id);
    try {
      if (accept) {
        await acceptInvitation(invitation.id);
        toast(`You joined “${invitation.workspaceName}”`);
        /* Rebuild the workspace switcher and the active-workspace context so
           the newly joined workspace is selectable right away. */
        window.dispatchEvent(new CustomEvent("zybble:workspace"));
        onAccepted?.();
      } else {
        await declineInvitation(invitation.id);
        toast(`Invitation to “${invitation.workspaceName}” declined`);
      }
      setInvitations((rows) => rows.filter((row) => row.id !== invitation.id));
    } catch (error) {
      toast((error as Error).message, "error");
      /* The server is authoritative: re-read so a stale or already-used
         invitation disappears instead of inviting another failed click. */
      load();
    } finally {
      setBusyId(null);
    }
  };

  if (!invitations.length) return null;

  return (
    <Card className="mb-3 p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md bg-brand-50 text-brand-700">
          <Mail className="size-3.5" aria-hidden="true" />
        </span>
        <h2 className="text-[13px] font-medium text-ink">
          {invitations.length === 1 ? "You have an invitation" : `You have ${invitations.length} invitations`}
        </h2>
      </div>
      <ul className="mt-3 grid gap-2">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-black/[0.07] bg-white px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink">{invitation.workspaceName}</p>
              <p className="mt-0.5 text-[11px] leading-4.5 text-ink-mute">
                {invitation.invitedBy} invited you as{" "}
                <Badge tone="neutral">{invitation.role === "admin" ? "Admin" : "Member"}</Badge>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Btn
                variant="outline"
                size="sm"
                disabled={busyId !== null}
                onClick={() => respond(invitation, false)}
              >
                Decline
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                disabled={busyId !== null}
                onClick={() => respond(invitation, true)}
              >
                {busyId === invitation.id ? "Joining…" : "Accept"}
              </Btn>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
