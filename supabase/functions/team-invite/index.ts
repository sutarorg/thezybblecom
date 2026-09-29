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

    const entitlements = await getEntitlements(sb, caller.id);
    const { data: members } = await sb
      .from("workspace_members")
      .select("user_id", { count: "exact" })
      .eq("workspace_id", workspaceId);
    if ((members?.length ?? 1) >= entitlements.allowances.seats) {
      throw new HttpError(403, `Your ${entitlements.plan} plan includes ${entitlements.allowances.seats} ${entitlements.allowances.seats === 1 ? "seat" : "seats"}.`);
    }

    // already a member?
    const { data: existing } = await sb
      .from("workspace_members")
      .select("invitation:workspace_invitations!workspace_id(email, status)")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .then((r) => ({ data: null, error: r.error }));
    void existing;

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

    const appUrl = Deno.env.get("APP_URL") ?? "https://zybble.app";
    await sendEmail({
      to: email,
      subject: `${inviterName} invited you to “${ws?.name ?? "a workspace"}” on Zybble`,
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#131514">
          <h1 style="font-size:20px;letter-spacing:-0.02em;margin:0 0 8px">You're invited to Zybble</h1>
          <p style="font-size:14px;line-height:22px;color:#6f7269;margin:0 0 20px">
            <strong style="color:#131514">${inviterName}</strong> invited you to join the
            <strong style="color:#131514">“${ws?.name ?? "workspace"}”</strong> workspace as a <strong style="color:#131514">${role}</strong>.
          </p>
          <a href="${appUrl}/#/signup?invite=${encodeURIComponent(email)}"
             style="display:inline-block;background:#0e7a52;color:#fff;font-size:13px;font-weight:500;padding:10px 20px;border-radius:999px;text-decoration:none">
            Accept invitation
          </a>
          <p style="font-size:12px;line-height:18px;color:#a3a69d;margin:20px 0 0">
            If you didn't expect this, you can ignore this email.
          </p>
        </div>`,
    });

    await logActivity(sb, {
      workspaceId,
      actorId: caller.id,
      kind: "invite",
      text: `Invited ${email} as ${role}`,
    });

    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
});
