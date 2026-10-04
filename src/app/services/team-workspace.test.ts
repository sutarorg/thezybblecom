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
  createWorkspace,
  getDefaultWorkspace,
  getSelectedWorkspaceId,
  getTeam,
  getWorkspace,
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
