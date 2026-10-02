import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & { status(code: number): VercelResponse; json(body: unknown): void };
type Json = Record<string, unknown>;

export const maxDuration = 30;

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "invite_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}
function bodyOf(req: VercelRequest): Json {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body as Json;
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
    } catch { throw new ApiError(400, "The invite request wasn't valid JSON.", "invalid_json"); }
  }
  throw new ApiError(400, "An invite request is required.", "missing_body");
}
function tokenOf(req: VercelRequest) {
  const value = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const token = value?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "Your session expired — sign in again.", "auth_missing");
  return token;
}
function client(token: string): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!url || !key) {
    const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)"].filter(Boolean).join(" and ");
    console.error("api request", { route: "/api/team-invite", status: 500, code: "supabase_config", missing });
    throw new ApiError(500, `The invite server isn't connected to Supabase. Missing env var(s): ${missing}.`, "supabase_config");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
}
async function requireAdmin(sb: SupabaseClient, workspaceId: string, userId: string) {
  const { data, error } = await sb.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (error || !data) throw new ApiError(403, "You don't have access to that workspace.", "workspace_forbidden");
  if (!["owner", "admin"].includes(data.role)) throw new ApiError(403, "Only a workspace owner or admin can invite members.", "role_forbidden");
  return data.role as string;
}
async function sendInviteEmail(opts: { to: string; subject: string; html: string }) {
  const key = env("RESEND_API_KEY");
  const from = env("RESEND_FROM_EMAIL") || "Zybble <hello@zybble.com>";
  if (!key) throw new ApiError(500, "Resend isn't configured, so the invitation email couldn't be sent.", "email_config");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn("api provider", { provider: "resend", status: response.status, responseKind: text ? "body" : "empty" });
    throw new ApiError(502, "The invitation was saved, but Resend couldn't deliver the email. Try again shortly.", "email_delivery_failed");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = bodyOf(req);
    const workspaceId = String(body.workspaceId ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = body.role === "admin" ? "admin" : "member";
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new ApiError(400, "A valid workspace is required.", "workspace_invalid");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Enter a valid email address.", "email_invalid");

    const token = tokenOf(req);
    const sb = client(token);
    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth.user) throw new ApiError(401, "Your session expired — sign in again.", "auth_invalid");
    await requireAdmin(sb, workspaceId, auth.user.id);

    const [{ data: ws }, { data: profile }, { data: sub }] = await Promise.all([
      sb.from("workspaces").select("name, owner_id").eq("id", workspaceId).maybeSingle(),
      sb.from("profiles").select("name").eq("id", auth.user.id).maybeSingle(),
      sb.from("subscriptions").select("plan_id, status").eq("user_id", auth.user.id).maybeSingle(),
    ]);
    if (!ws) throw new ApiError(404, "Workspace not found.", "workspace_not_found");
    const planId = sub && ["active", "trialing"].includes(sub.status) ? sub.plan_id : "free";
    const { data: plan } = await sb.from("plans").select("max_users").eq("id", planId).maybeSingle();
    const maxUsers = plan?.max_users ?? 1;
    const [{ count: activeCount }, { count: pendingCount }] = await Promise.all([
      sb.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      sb.from("workspace_invitations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pending"),
    ]);
    if ((activeCount ?? 0) + (pendingCount ?? 0) >= maxUsers) {
      throw new ApiError(403, `Your current plan includes ${maxUsers} ${maxUsers === 1 ? "seat" : "seats"}.`, "seat_limit");
    }

    const { data: existingInvite } = await sb.from("workspace_invitations").select("id, status").eq("workspace_id", workspaceId).eq("email", email).maybeSingle();
    const { error: inviteError } = await sb.from("workspace_invitations").upsert({
      workspace_id: workspaceId,
      inviter_id: auth.user.id,
      email,
      role,
      status: "pending",
    }, { onConflict: "workspace_id,email" });
    if (inviteError) throw new ApiError(500, "Couldn't create the invitation.", "invite_persist_failed");

    const appUrl = env("APP_URL") || "https://zybble.com";
    const inviterName = profile?.name ?? "A teammate";
    const workspaceName = ws.name ?? "workspace";
    await sendInviteEmail({
      to: email,
      subject: `${inviterName} invited you to “${workspaceName}” on Zybble`,
      html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#131514">
        <h1 style="font-size:20px;letter-spacing:-0.02em;margin:0 0 8px">You're invited to Zybble</h1>
        <p style="font-size:14px;line-height:22px;color:#6f7269;margin:0 0 20px"><strong style="color:#131514">${escapeHtml(inviterName)}</strong> invited you to join <strong style="color:#131514">${escapeHtml(workspaceName)}</strong> as a <strong style="color:#131514">${role}</strong>.</p>
        <a href="${appUrl}/signup?invite=${encodeURIComponent(email)}" style="display:inline-block;background:#0e7a52;color:#fff;font-size:13px;font-weight:500;padding:10px 20px;border-radius:999px;text-decoration:none">Accept invitation</a>
        <p style="font-size:12px;line-height:18px;color:#a3a69d;margin:20px 0 0">If you didn't expect this, you can ignore this email.</p>
      </div>`,
    });

    await sb.from("activity_logs").insert({ workspace_id: workspaceId, actor_id: auth.user.id, kind: "invite", text: `Invited ${email} as ${role}` }).then(() => undefined);
    return res.status(200).json({ ok: true, emailSent: true, invitationUpdated: Boolean(existingInvite) });
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "Invitation failed. Please try again.", "unknown");
    if (!(error instanceof ApiError)) console.error("api request", { route: "/api/team-invite", status: 500, code: "unknown" });
    return res.status(apiError.status).json({ error: apiError.message, code: apiError.code });
  }
}
