// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Render-level coverage for the invitation banner.
 *
 * Before this component existed, an invited teammate had no way at all to
 * accept: the email linked to /signup, signing up created a brand-new
 * personal workspace, and the pending row sat in `workspace_invitations`
 * forever. The banner is mounted on /overview (where an invited signup
 * actually lands) and /workspaces.
 *
 * These cases assert the three things that must hold on a host page:
 *   • it renders nothing at all when there is no invitation (it must never
 *     push a page down or show an empty card);
 *   • a load failure is swallowed — a broken invitation lookup must not take
 *     Overview down with it;
 *   • accepting calls the RPC once and tells the rest of the app to refresh.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
// react-dom/client needs this flag before act() will flush effects in jsdom.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  listMyInvitations: vi.fn(),
  acceptInvitation: vi.fn(),
  declineInvitation: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../services/api", () => ({
  listMyInvitations: h.listMyInvitations,
  acceptInvitation: h.acceptInvitation,
  declineInvitation: h.declineInvitation,
}));
vi.mock("./ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./ui");
  return { ...actual, useToast: () => h.toast };
});

import { PendingInvitations } from "./PendingInvitations";

const INVITE = {
  id: "inv-1",
  workspaceId: "ws-9",
  workspaceName: "Northwind Agency",
  role: "member",
  email: "sam@example.test",
  invitedBy: "Dana",
  createdAt: "2026-10-01T00:00:00Z",
  expiresAt: "2026-10-08T00:00:00Z",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
}

describe("PendingInvitations", () => {
  it("renders nothing when the user has no invitations", async () => {
    h.listMyInvitations.mockResolvedValue([]);
    await render(<PendingInvitations />);
    expect(container.innerHTML).toBe("");
  });

  it("never breaks its host page when the lookup fails", async () => {
    h.listMyInvitations.mockRejectedValue(new Error("relation does not exist"));
    await render(<PendingInvitations />);
    expect(container.innerHTML).toBe("");
  });

  it("shows who invited you, to which workspace, and as what", async () => {
    h.listMyInvitations.mockResolvedValue([INVITE]);
    await render(<PendingInvitations />);
    const text = container.textContent ?? "";
    expect(text).toContain("Northwind Agency");
    expect(text).toContain("Dana");
    expect(text.toLowerCase()).toContain("member");
    expect(container.querySelectorAll("button").length).toBeGreaterThanOrEqual(2);
  });

  it("accepts through the RPC and tells the app to reload the workspace list", async () => {
    h.listMyInvitations.mockResolvedValue([INVITE]);
    h.acceptInvitation.mockResolvedValue({ workspaceId: "ws-9" });
    const onAccepted = vi.fn();
    const refreshed = vi.fn();
    window.addEventListener("zybble:workspace", refreshed);

    await render(<PendingInvitations onAccepted={onAccepted} />);
    const accept = [...container.querySelectorAll("button")].find((b) =>
      /accept/i.test(b.textContent ?? ""),
    );
    expect(accept).toBeTruthy();

    await act(async () => {
      accept!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(h.acceptInvitation).toHaveBeenCalledTimes(1);
    expect(h.acceptInvitation).toHaveBeenCalledWith("inv-1");
    expect(refreshed).toHaveBeenCalled();
    expect(onAccepted).toHaveBeenCalled();
    // The accepted invitation is gone from the banner.
    expect(container.textContent ?? "").not.toContain("Northwind Agency");

    window.removeEventListener("zybble:workspace", refreshed);
  });

  it("re-reads the list when accepting fails, so a stale row cannot be clicked again", async () => {
    h.listMyInvitations.mockResolvedValueOnce([INVITE]).mockResolvedValueOnce([]);
    h.acceptInvitation.mockRejectedValue(new Error("That invitation is no longer valid."));

    await render(<PendingInvitations />);
    const accept = [...container.querySelectorAll("button")].find((b) =>
      /accept/i.test(b.textContent ?? ""),
    );
    await act(async () => {
      accept!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/no longer valid/i), "error");
    expect(h.listMyInvitations).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toBe("");
  });

  it("declines without touching the accept path", async () => {
    h.listMyInvitations.mockResolvedValue([INVITE]);
    h.declineInvitation.mockResolvedValue(undefined);

    await render(<PendingInvitations />);
    const decline = [...container.querySelectorAll("button")].find((b) =>
      /decline/i.test(b.textContent ?? ""),
    );
    await act(async () => {
      decline!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(h.declineInvitation).toHaveBeenCalledWith("inv-1");
    expect(h.acceptInvitation).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });
});
