// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Team + workspace data-path tests.
 *
 * These pin down the two production failures this change set fixes:
 *
 *  1. /team died with "Could not find a relationship between
 *     'workspace_members' and 'user_id' in the schema cache" because the
 *     query asked PostgREST to embed `profiles` through a foreign key that
 *     does not (and must not) exist. The roster now comes from the
 *     `list_workspace_team` RPC.
 *
 *  2. /workspaces died with "You don't have access to that resource." The
 *     list now comes from `list_user_workspaces`, which resolves ownership OR
 *     membership server-side, and a stale localStorage selection is dropped
 *     instead of wedging the app.
 */

const h = vi.hoisted(() => {
  const getSession = vi.fn();
  const rpc = vi.fn();
  const from = vi.fn();
  const client = { auth: { getSession }, from, rpc, functions: { invoke: vi.fn() } };
  return { client, getSession, rpc, from };
});

vi.mock("./supabase", () => ({
  getSupabase: () => h.client,
  BACKEND_ENABLED: true,
}));

import {
  acceptInvitation,
  renameWorkspace,
  createWorkspace,
  getDefaultWorkspace,
  getSelectedWorkspaceId,
  getTeam,
  declineInvitation,
  getWorkspace,
  listMyInvitations,
  listWorkspaces,
  setSelectedWorkspaceId,
} from "./api";

const WS_ROW = {
  id: "ws-1",
  name: "Acme workspace",
  owner_id: "u1",
  owner_name: "Ada",
  plan_id: "agency",
  is_client: false,
  created_at: "2026-01-01T00:00:00.000Z",
  member_count: 3,
  leads_used: 120,
  searches: 4,
  lists: 2,
};

function invitationsBuilder(rows: unknown[], error: unknown = null) {
  const builder = {
    select: vi.fn((_columns?: string, _options?: unknown) => builder),
    eq: vi.fn(() => builder),
    order: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return builder;
}

beforeEach(() => {
  h.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "t", user: { id: "u1" } } } });
  h.rpc.mockReset();
  h.from.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listWorkspaces", () => {
  it("reads through the RLS-equivalent RPC, not a PostgREST embed", async () => {
    h.rpc.mockResolvedValue({ data: [WS_ROW], error: null });

    const rows = await listWorkspaces();

    expect(h.rpc).toHaveBeenCalledWith("list_user_workspaces");
    expect(h.from).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "ws-1",
      name: "Acme workspace",
      owner: "Ada",
      plan: "Agency",
      members: 3,
      leads_used: 120,
      leads_limit: 15000,
    });
  });

  it("translates a denial into the product's plain-language message", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "permission denied for table workspaces" } });
    await expect(listWorkspaces()).rejects.toThrow("You don't have access to that resource.");
  });
});

describe("getWorkspace", () => {
  it("returns null (recoverable) for an id the caller cannot access", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    await expect(getWorkspace("ws-someone-else")).resolves.toBeNull();
    expect(h.rpc).toHaveBeenCalledWith("get_user_workspace", { ws: "ws-someone-else" });
  });
});

describe("getDefaultWorkspace", () => {
  it("drops a stale localStorage selection instead of failing", async () => {
    setSelectedWorkspaceId("ws-deleted");
    h.rpc.mockResolvedValue({ data: [WS_ROW], error: null });

    const workspace = await getDefaultWorkspace();

    expect(workspace?.id).toBe("ws-1");
    expect(getSelectedWorkspaceId()).toBe("ws-1");
  });

  it("keeps a valid selection", async () => {
    const second = { ...WS_ROW, id: "ws-2", name: "Client · Sunrise" };
    setSelectedWorkspaceId("ws-2");
    h.rpc.mockResolvedValue({ data: [WS_ROW, second], error: null });

    const workspace = await getDefaultWorkspace();
    expect(workspace?.id).toBe("ws-2");
  });

  it("recovers the personal workspace when the list comes back empty", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: [], error: null }) // list_user_workspaces
      .mockResolvedValueOnce({ data: "ws-1", error: null }) // ensure_personal_workspace
      .mockResolvedValueOnce({ data: [WS_ROW], error: null }); // list again

    const workspace = await getDefaultWorkspace();
    expect(h.rpc).toHaveBeenNthCalledWith(2, "ensure_personal_workspace");
    expect(workspace?.id).toBe("ws-1");
  });
});

describe("createWorkspace", () => {
  it("creates the workspace and its owner membership in one atomic RPC", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: "ws-new", error: null })
      .mockResolvedValueOnce({ data: [{ ...WS_ROW, id: "ws-new", name: "Client · Sunrise" }], error: null });

    const created = await createWorkspace("Client · Sunrise");

    expect(h.rpc).toHaveBeenNthCalledWith(1, "create_client_workspace", { ws_name: "Client · Sunrise" });
    expect(created.id).toBe("ws-new");
    // No direct table insert — that two-step path could leave a workspace
    // without a membership row, which made it unreadable afterwards.
    expect(h.from).not.toHaveBeenCalled();
  });

  it("surfaces the entitlement error for a plan without client workspaces", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "client_workspaces_not_available" } });
    await expect(createWorkspace("Client · Sunrise")).rejects.toThrow(
      "Client workspaces are available on Agency and Scale.",
    );
  });
});

describe("getTeam", () => {
  it("builds the roster from the RPC (name, email, role, status, joined)", async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "list_workspace_team") {
        return Promise.resolve({
          data: [
            {
              user_id: "u1",
              role: "owner",
              joined_at: "2026-01-01T00:00:00.000Z",
              name: "Ada Lovelace",
              email: "ada@zybble.com",
              avatar_url: null,
              is_owner: true,
            },
            {
              user_id: "u2",
              role: "member",
              joined_at: "2026-02-01T00:00:00.000Z",
              name: "",
              email: "grace@zybble.com",
              avatar_url: null,
              is_owner: false,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [WS_ROW], error: null });
    });
    h.from.mockReturnValue(
      invitationsBuilder([
        { id: "inv-1", email: "alan@zybble.com", role: "member", status: "pending", created_at: "2026-03-01T00:00:00.000Z" },
      ]),
    );

    const team = await getTeam("ws-1");

    expect(h.rpc).toHaveBeenCalledWith("list_workspace_team", { ws: "ws-1" });
    expect(h.from).toHaveBeenCalledWith("workspace_invitations");
    expect(team).toHaveLength(3);

    expect(team[0]).toMatchObject({
      id: "u1",
      name: "Ada Lovelace",
      email: "ada@zybble.com",
      role: "owner",
      workspace: "Acme workspace",
      status: "active",
      joined_at: "2026-01-01T00:00:00.000Z",
      initials: "AL",
    });
    // A member with no profile name still gets a usable display name.
    expect(team[1]).toMatchObject({ id: "u2", name: "grace", email: "grace@zybble.com", role: "member", status: "active" });
    expect(team[2]).toMatchObject({ id: "inv-1", email: "alan@zybble.com", status: "invited", role: "member" });
  });

  it("reports the real cause instead of hiding it", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find a relationship between 'workspace_members' and 'user_id' in the schema cache" },
    });
    h.from.mockReturnValue(invitationsBuilder([]));

    await expect(getTeam("ws-1")).rejects.toThrow(/relationship/i);
  });

  it("does not embed profiles through workspace_members", async () => {
    h.rpc.mockImplementation((fn: string) =>
      Promise.resolve({ data: fn === "list_workspace_team" ? [] : [WS_ROW], error: null }),
    );
    const builder = invitationsBuilder([]);
    h.from.mockReturnValue(builder);

    await getTeam("ws-1");

    const selects = builder.select.mock.calls.map(([columns]) => String(columns));
    for (const select of selects) expect(select).not.toContain("profiles:user_id");
    expect(h.from).not.toHaveBeenCalledWith("workspace_members");
  });
});


/* ------------------------------------------------------------------ */
/* Invitations received by the signed-in user                          */
/*                                                                     */
/* Before this change the product had no way to accept an invitation at
   all: /api/team-invite emailed a link to /signup, the invitee created
   their own personal workspace, and the invitation stayed `pending`
   forever while still consuming one of the inviter's paid seats.       */
/* ------------------------------------------------------------------ */
describe("listMyInvitations", () => {
  it("reads through the RPC that resolves the caller's email server-side", async () => {
    h.rpc.mockResolvedValue({
      data: [
        {
          id: "inv-1",
          workspace_id: "ws-1",
          workspace_name: "Acme workspace",
          role: "admin",
          invited_by: "Ada",
          created_at: "2026-02-01T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const rows = await listMyInvitations();

    expect(h.rpc).toHaveBeenCalledWith("list_my_invitations");
    // auth.users is not client-readable, so the email must never be a filter
    // the browser supplies — that is exactly how one user could enumerate or
    // claim another user's invitation.
    expect(h.from).not.toHaveBeenCalled();
    expect(rows).toEqual([
      {
        id: "inv-1",
        workspaceId: "ws-1",
        workspaceName: "Acme workspace",
        role: "admin",
        invitedBy: "Ada",
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
  });

  it("degrades quietly when the RPC has not been deployed yet", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Could not find the function public.list_my_invitations in the schema cache' },
    });
    await expect(listMyInvitations()).resolves.toEqual([]);
  });

  it("surfaces a real failure instead of pretending there are no invitations", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "network timeout" } });
    await expect(listMyInvitations()).rejects.toThrow("network timeout");
  });
});

describe("acceptInvitation / declineInvitation", () => {
  it("joins through the security-definer RPC and returns the workspace id", async () => {
    h.rpc.mockResolvedValue({ data: "ws-1", error: null });
    await expect(acceptInvitation("inv-1")).resolves.toBe("ws-1");
    expect(h.rpc).toHaveBeenCalledWith("accept_invitation", { invitation_id: "inv-1" });
  });

  it("translates the seat-limit trigger into plan language", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'seat_limit_reached' } });
    await expect(acceptInvitation("inv-1")).rejects.toThrow("team-seat limit");
  });

  it("explains an invitation addressed to a different email", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "invitation_email_mismatch" } });
    await expect(acceptInvitation("inv-1")).rejects.toThrow(/different email address/i);
  });

  it("declines through its own RPC", async () => {
    h.rpc.mockResolvedValue({ data: true, error: null });
    await expect(declineInvitation("inv-1")).resolves.toBeUndefined();
    expect(h.rpc).toHaveBeenCalledWith("decline_invitation", { invitation_id: "inv-1" });
  });
});

describe("renameWorkspace", () => {
  /**
   * Settings → Workspace showed a name field, a Save button and a
   * "Workspace saved" toast while writing nothing at all; the old name came
   * back on the next load. The write is real now, and RLS decides who may do
   * it.
   */
  beforeEach(() => {
    h.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" }, access_token: "t" } } });
  });

  function updateStub(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn(async () => result);
    const select = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    h.from.mockReturnValue({ update });
    return { update, eq, select, maybeSingle };
  }

  it("writes the trimmed name to the workspaces row and returns the stored record", async () => {
    const stub = updateStub({
      data: { id: "ws-1", name: "Northwind Agency", plan_id: "agency", owner_id: "user-1", created_at: "2026-01-01T00:00:00Z" },
      error: null,
    });

    const result = await renameWorkspace("ws-1", "  Northwind Agency  ");

    expect(h.from).toHaveBeenCalledWith("workspaces");
    expect(stub.update).toHaveBeenCalledWith({ name: "Northwind Agency" });
    expect(stub.eq).toHaveBeenCalledWith("id", "ws-1");
    expect(result.name).toBe("Northwind Agency");
  });

  it("rejects names the database would not accept, without touching the network", async () => {
    h.from.mockReset();
    await expect(renameWorkspace("ws-1", " a ")).rejects.toThrow(/at least 2 characters/i);
    await expect(renameWorkspace("ws-1", "x".repeat(81))).rejects.toThrow(/under 80 characters/i);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("reports a permission problem when RLS filters the update away", async () => {
    // RLS silently matches zero rows for a non-admin member rather than erroring.
    updateStub({ data: null, error: null });
    await expect(renameWorkspace("ws-1", "Renamed by a member")).rejects.toThrow(/owner or admin/i);
  });

  it("surfaces a readable database error", async () => {
    updateStub({ data: null, error: { message: "new row violates row-level security policy" } });
    await expect(renameWorkspace("ws-1", "Renamed")).rejects.toThrow();
  });
});
