import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-level guards for the admin console.
 *
 * The migration can't be executed here (no Postgres in CI), so these tests
 * lock in the properties that make the console safe to deploy:
 *
 *  • privileged SQL is service-role only — never reachable with a customer's
 *    JWT through PostgREST;
 *  • the audit table is append-only and admin-read-only;
 *  • no existing RLS policy is relaxed;
 *  • no privileged credential is exposed to the browser bundle;
 *  • the browser never talks to Supabase with admin intent — it goes through
 *    /api/admin/*.
 */

const root = process.cwd();
const migration = readFileSync(join(root, "supabase", "migrations", "0008_admin_console.sql"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const adminClientFiles = walk(join(root, "src", "app", "admin"));
const adminClientSource = adminClientFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const adminApiSource = [
  "api/admin.ts",
  "api/_lib/admin-core.ts",
  "api/_lib/admin-read.ts",
  "api/_lib/admin-actions.ts",
]
  .map((file) => readFileSync(join(root, file), "utf8"))
  .join("\n");

describe("admin database layer (0008)", () => {
  it("adds the audit table with the five facts an audit entry needs", () => {
    expect(migration).toMatch(/create table if not exists admin_audit_logs/);
    for (const column of ["admin_user_id", "action", "target_type", "target_id", "created_at", "ip", "before_state", "after_state"]) {
      expect(migration).toContain(column);
    }
  });

  it("makes the audit log append-only, even for the service role", () => {
    expect(migration).toMatch(/create or replace function admin_audit_logs_immutable/);
    expect(migration).toMatch(/before update on admin_audit_logs/);
    expect(migration).toMatch(/before delete on admin_audit_logs/);
    expect(migration).toMatch(/alter table admin_audit_logs enable row level security/);
  });

  it("lets only administrators read the audit log, and nobody write it via PostgREST", () => {
    expect(migration).toMatch(/create policy "admin audit read" on admin_audit_logs\s*\nfor select using \(is_zybble_admin\(\)\);/);
    expect(migration).not.toMatch(/create policy[^;]*on admin_audit_logs[^;]*for (insert|update|delete)/i);
  });

  it("revokes every admin function from anon and authenticated and grants it to service_role only", () => {
    const functions = [...migration.matchAll(/create or replace function (admin_[a-z_]+)\(/g)].map((match) => match[1]);
    expect(functions.length).toBeGreaterThan(10);
    for (const fn of functions) {
      if (fn === "admin_audit_logs_immutable") continue;
      expect(migration).toMatch(new RegExp(`revoke execute on function ${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(migration).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to service_role;`));
    }
  });

  it("pins search_path on every security definer function", () => {
    const definers = migration.split("create or replace function").filter((block) => /security definer/.test(block));
    expect(definers.length).toBeGreaterThan(10);
    for (const block of definers) {
      expect(block).toMatch(/set search_path = public/);
    }
  });

  it("never disables or loosens row level security", () => {
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security/i);
    // The only policy this migration drops is the one it immediately recreates
    // on its own new table.
    expect(migration).not.toMatch(/drop\s+policy[^;]*on\s+(?!admin_audit_logs)/i);
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("keeps the role-change guard, and only widens it for a service-role-only function", () => {
    expect(migration).toMatch(/create or replace function protect_profile_role/);
    expect(migration).toMatch(/raise exception 'Only an administrator can change profile roles'/);
    expect(migration).toMatch(/current_setting\('zybble\.role_change', true\)/);
    expect(migration).toMatch(/revoke execute on function admin_grant_role\(uuid, text\) from public, anon, authenticated;/);
    expect(migration).toMatch(/grant execute on function admin_grant_role\(uuid, text\) to service_role;/);
  });

  it("refuses to remove the last administrator in SQL, not just in the UI", () => {
    expect(migration).toMatch(/raise exception 'last_admin'/);
  });

  it("never returns a raw webhook payload", () => {
    const detail = migration.slice(migration.indexOf("function admin_webhook_detail"));
    expect(detail).not.toMatch(/'payload',\s*we\.payload/);
  });
});

describe("admin API boundary", () => {
  it("authorizes before it routes, on every request", () => {
    const file = readFileSync(join(root, "api", "admin.ts"), "utf8");
    const handlerSource = file.slice(file.indexOf("export default async function handler"));
    const authIndex = handlerSource.indexOf("await requireAdmin(req)");
    const readIndex = handlerSource.indexOf("handleGet(ctx");
    const writeIndex = handlerSource.indexOf("handleWrite(ctx");
    expect(authIndex).toBeGreaterThan(0);
    expect(authIndex).toBeLessThan(readIndex);
    expect(authIndex).toBeLessThan(writeIndex);
  });

  it("re-reads profiles.role server-side instead of trusting a JWT claim", () => {
    const core = readFileSync(join(root, "api", "_lib", "admin-core.ts"), "utf8");
    expect(core).toMatch(/\.from\("profiles"\)[\s\S]{0,120}\.eq\("id", user\.id\)/);
    expect(core).toMatch(/profile\.role !== "admin"/);
    expect(core).not.toMatch(/app_metadata|user_metadata/);
  });

  it("never caches admin responses", () => {
    expect(readFileSync(join(root, "api", "admin.ts"), "utf8")).toMatch(/Cache-Control", "no-store/);
  });

  it("requires a reason and a confirmation for every mutation", () => {
    const actions = readFileSync(join(root, "api", "_lib", "admin-actions.ts"), "utf8");
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
    expect(exported.sort()).toEqual(["overrideUsage", "setUserRole", "setUserSuspension", "syncSubscription", "updatePlan"]);
    for (const fn of exported) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      const scoped = body.slice(0, body.indexOf("\n}\n") + 1);
      expect(scoped).toMatch(/requireReason\(/);
      expect(scoped).toMatch(/writeAudit\(/);
    }
  });

  it("never reads a secret value into a response", () => {
    expect(adminApiSource).not.toMatch(/SERVICE_ROLE_KEY["'`]\s*\)\s*[,}]?\s*$/m);
    // Config is reported as a boolean, never echoed.
    expect(adminApiSource).toMatch(/Boolean\(readServerEnv\("SERPAPI_API_KEY"\)\)/);
    expect(adminApiSource).not.toMatch(/key:\s*readServerEnv/);
  });
});

describe("admin browser bundle", () => {
  it("never references a privileged environment variable", () => {
    for (const secret of [
      "SERVICE_ROLE",
      "SUPABASE_SECRET",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "OPENROUTER_API_KEY",
      "SERPAPI_API_KEY",
      "RESEND_API_KEY",
    ]) {
      expect(adminClientSource).not.toContain(secret);
    }
    expect(adminClientSource).not.toMatch(/import\.meta\.env\.VITE_(?!SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY)/);
  });

  it("reaches privileged data only through the same-origin admin API", () => {
    expect(adminClientSource).toMatch(/fetch\(buildUrl\(path, options\.params\)/);
    expect(adminClientSource).not.toMatch(/\.rpc\(/);
    expect(adminClientSource).not.toMatch(/api\.razorpay\.com|openrouter\.ai|serpapi\.com/);
    // The only Supabase use in the console is reading the caller's own session.
    const supabaseUses = adminClientSource.match(/getSupabase\(\)/g) ?? [];
    expect(supabaseUses.length).toBe(1);
  });

  it("does not gate access on a client-side flag", () => {
    expect(adminClientSource).toMatch(/adminGet<AdminIdentity>\("me"\)/);
    expect(adminClientSource).not.toMatch(/localStorage[\s\S]{0,40}admin/i);
    expect(adminClientSource).not.toMatch(/isAdmin\s*\?\?|if \(.*isAdmin\)/);
  });
});
