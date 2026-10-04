// ============================================================================
// team-invite — create invitation (seat limit enforced server-side) + email.
// ============================================================================
import {
  HttpError,
  callerFromRequest,
  corsHeaders,
  errorJson,
  getEntitlements,
  handleError,
  json,
  logActivity,
  requireWorkspaceRole,
  sendEmail,
  serviceClient,
} from "../_shared/index.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  try {
    const sb = serviceClient();
    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = body.role === "admin" ? "admin" : "member";
    if (!workspaceId) throw new HttpError(400, "workspaceId is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");

    const caller = await callerFromRequest(req, sb);
    await requireWorkspaceRole(sb, caller.id, workspaceId, ["owner", "admin"]);

    /* Seats come from the WORKSPACE OWNER's effective plan (identical to the
       enforce_seat_limit() trigger and to /api/team-invite), and a pending
       invitation already holds a seat. */
    const { data: ownerRow } = await sb.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
    const ownerId = ownerRow?.owner_id ?? caller.id;
    const entitlements = await getEntitlements(sb, ownerId);
    const seats = entitlements.allowances.seats;

    const [{ count: memberCount }, { count: pendingInvites }] = await Promise.all([
      sb.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb
        .from("workspace_invitations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "pending"),
    ]);
    if ((memberCount ?? 0) + (pendingInvites ?? 0) >= seats) {
      throw new HttpError(403, `Your ${entitlements.plan} plan includes ${seats} ${seats === 1 ? "seat" : "seats"}.`);
    }

    const { data: ws } = await sb.from("workspaces").select("name").eq("id", workspaceId).single();
    const inviterName = (await sb.from("profiles").select("name").eq("id", caller.id).single()).data?.name ?? "A teammate";

    const { error: inviteErr } = await sb.from("workspace_invitations").upsert(
      {
        workspace_id: workspaceId,
        inviter_id: caller.id,
        email,
        role,
        status: "pending",
      },
      { onConflict: "workspace_id,email" }
    );
    if (inviteErr) throw new HttpError(500, "Couldn't create the invitation.");

    const appUrl = Deno.env.get("APP_URL") ?? "https://zybble.com";
    const delivery = await sendEmail({
      to: email,
      subject: `${inviterName} invited you to “${ws?.name ?? "a workspace"}” on Zybble`,
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#131514">
          <h1 style="font-size:20px;letter-spacing:-0.02em;margin:0 0 8px">You're invited to Zybble</h1>
          <p style="font-size:14px;line-height:22px;color:#6f7269;margin:0 0 20px">
            <strong style="color:#131514">${inviterName}</strong> invited you to join the
            <strong style="color:#131514">“${ws?.name ?? "workspace"}”</strong> workspace as a <strong style="color:#131514">${role}</strong>.
          </p>
          <a href="${appUrl}/signup?invite=${encodeURIComponent(email)}"
             style="display:inline-block;background:#0e7a52;color:#fff;font-size:13px;font-weight:500;padding:10px 20px;border-radius:999px;text-decoration:none">
            Accept invitation
          </a>
          <p style="font-size:12px;line-height:18px;color:#a3a69d;margin:20px 0 0">
            If you didn't expect this, you can ignore this email.
          </p>
        </div>`,
    });
    if (!delivery.sent) {
      throw new HttpError(502, "The invitation was saved, but the email could not be delivered. Check Resend configuration and try again.");
    }

    await logActivity(sb, {
      workspaceId,
      actorId: caller.id,
      kind: "invite",
      text: `Invited ${email} as ${role}`,
    });

    return json({ ok: true, emailSent: true });
  } catch (e) {
    return handleError(e);
  }
});
