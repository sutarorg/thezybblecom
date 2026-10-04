import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-level guards for the database layer.
 *
 * These cannot execute SQL, but they do lock in the decisions that the
 * production incidents turned on:
 *  • the Team fix must NOT be an invented foreign key just to satisfy
 *    PostgREST's embed resolver;
 *  • the Workspaces fix must NOT make `workspaces` publicly readable or
 *    disable RLS;
 *  • billing must be INR everywhere;
 *  • migrations must be additive (0006 is new; older files untouched).
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const repair = readFileSync(join(DIR, "0006_team_workspace_billing_repair.sql"), "utf8");
const membership = readFileSync(join(DIR, "0007_membership_security_and_invitations.sql"), "utf8");
const all = files.map((f) => readFileSync(join(DIR, f), "utf8")).join("\n");

describe("migration set", () => {
  it("adds every repair as a NEW migration rather than editing deployed ones", () => {
    expect(files).toContain("0006_team_workspace_billing_repair.sql");
    expect(files).toContain("0007_membership_security_and_invitations.sql");
    expect(files[files.length - 1]).toBe("0007_membership_security_and_invitations.sql");
  });

  it("never disables row level security", () => {
    expect(all).not.toMatch(/disable\s+row\s+level\s+security/i);
  });
});

describe("team relationship fix", () => {
  it("does not create a fake workspace_members.user_id → profiles.id foreign key", () => {
    expect(repair).not.toMatch(/workspace_members[\s\S]{0,120}references\s+profiles/i);
    expect(repair).not.toMatch(/add\s+constraint[\s\S]{0,160}foreign\s+key\s*\(\s*user_id\s*\)[\s\S]{0,60}references\s+profiles/i);
  });

  it("joins membership → profiles → auth.users inside an authorized RPC instead", () => {
    expect(repair).toContain("create function list_workspace_team(ws uuid)");
    expect(repair).toMatch(/left join auth\.users/);
    expect(repair).toMatch(/if not can_access_workspace\(ws\) then\s*\n\s*raise exception 'not_authorized'/);
    expect(repair).toContain("revoke execute on function list_workspace_team(uuid) from public, anon;");
    expect(repair).toContain("grant execute on function list_workspace_team(uuid) to authenticated;");
  });
});

describe("workspace authorization fix", () => {
  it("gives owners access to their own workspace without widening it to everyone", () => {
    expect(repair).toContain('create policy "workspaces member read" on workspaces');
    expect(repair).toMatch(/for select using \(owner_id = auth\.uid\(\) or is_workspace_member\(id\)\)/);
    expect(repair).not.toMatch(/on workspaces\s+for select using \(true\)/i);
  });

  it("creates client workspaces atomically, with the entitlement checked server-side", () => {
    expect(repair).toContain("create function create_client_workspace(ws_name text)");
    expect(repair).toContain("client_workspaces_not_available");
    expect(repair).toMatch(/on conflict \(workspace_id, user_id\) do nothing/);
  });

  it("backfills missing owner memberships without creating duplicates", () => {
    expect(repair).toMatch(/insert into workspace_members \(workspace_id, user_id, role\)[\s\S]{0,400}on conflict \(workspace_id, user_id\) do nothing;/);
  });
});

describe("billing schema", () => {
  it("is INR only", () => {
    expect(repair).toMatch(/alter table payments alter column currency set default 'INR'/);
    expect(repair).toMatch(/alter table invoices alter column currency set default 'INR'/);
    expect(repair).toMatch(/update payments set currency = 'INR'/);
    expect(repair).toMatch(/update invoices set currency = 'INR'/);
  });

  it("parks pending checkouts outside the entitlement table", () => {
    expect(repair).toContain("create table if not exists subscription_checkouts");
    expect(repair).toMatch(/razorpay_subscription_id text not null unique/);
  });

  it("makes duplicate webhook deliveries unable to duplicate an invoice", () => {
    expect(repair).toContain("create unique index if not exists invoices_razorpay_invoice_uidx");
  });

  it("only entitles on active/trialing or an unexpired cancelled period", () => {
    expect(repair).toContain("create or replace function effective_plan_for_user(u uuid)");
    expect(repair).toMatch(/s\.status in \('active', 'trialing'\)/);
    expect(repair).toMatch(/s\.current_period_end > now\(\)/);
  });
});

describe("membership privilege escalation fix (0007)", () => {
  it("removes the self-insert escape hatch that let anyone join any workspace", () => {
    expect(membership).toContain('create policy "members owner admin insert" on workspace_members');
    expect(membership).toMatch(/for insert with check \(can_manage_workspace\(workspace_id\)\);/);
    // the dangerous clause must not come back on insert/update
    // Only the executable statements, not the header comment that quotes the
    // vulnerable policy it replaces.
    const statements = membership
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const insertUpdate = statements.slice(
      statements.indexOf('"members owner admin insert"'),
      statements.indexOf('"members remove or self remove"'),
    );
    expect(insertUpdate).not.toMatch(/user_id = auth\.uid\(\)/);
  });

  it("keeps self-removal possible but protects the owner's own membership row", () => {
    expect(membership).toMatch(/for delete using \(\s*\(user_id = auth\.uid\(\) or can_manage_workspace\(workspace_id\)\)/);
    expect(membership).toContain("owner_role_immutable");
  });

  it("does not widen any policy to everyone", () => {
    expect(membership).not.toMatch(/using \(true\)/i);
    expect(membership).not.toMatch(/with check \(true\)/i);
  });
});

describe("invitation lifecycle (0007)", () => {
  it("ships the invitee-facing RPCs the application needs to accept or decline", () => {
    expect(membership).toContain("create or replace function list_my_invitations()");
    expect(membership).toContain("create or replace function accept_invitation(invitation_id uuid)");
    expect(membership).toContain("create or replace function decline_invitation(invitation_id uuid)");
  });

  it("authorizes every invitee RPC on the caller's verified email", () => {
    for (const fn of ["list_my_invitations", "accept_invitation", "decline_invitation"]) {
      expect(membership).toContain(`revoke execute on function ${fn}`);
      expect(membership).toContain(`to authenticated;`);
    }
    expect(membership.match(/invitation_email_mismatch/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("locks the invitation row so two tabs cannot both consume the last seat", () => {
    expect(membership).toMatch(/from workspace_invitations where id = invitation_id for update/);
    expect(membership).toContain("seat_limit_reached");
  });

  it("is idempotent for a teammate who is already a member", () => {
    expect(membership).toMatch(/if already then[\s\S]{0,160}return inv\.workspace_id;/);
  });

  it("drops the invitee update policy that could never be satisfied", () => {
    expect(membership).toContain('drop policy if exists "invitations invitee update" on workspace_invitations;');
  });
});
