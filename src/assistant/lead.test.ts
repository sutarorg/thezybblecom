/**
 * Lead-capture policy tests — these encode the ethical rules the feature
 * was built around, so a future change can't silently regress them:
 * no ask on the first answer, no re-ask after a decline, consent before
 * any email field, graceful failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENGAGEMENT_TURNS,
  detectLeadIntent,
  getLeadState,
  setLeadState,
  shouldOfferLead,
  submitAiLead,
} from "./lead";

function stubSessionStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

describe("Zybble AI lead capture policy", () => {
  beforeEach(() => {
    stubSessionStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("NEVER offers on the first user turn, even with the strongest intent", () => {
    expect(shouldOfferLead(1, "pricing")).toBe(false);
    expect(shouldOfferLead(1, "email_interest")).toBe(false);
    expect(shouldOfferLead(0, "pricing")).toBe(false);
  });

  it("offers from the second turn when intent is detected", () => {
    expect(shouldOfferLead(2, "pricing")).toBe(true);
    expect(shouldOfferLead(3, "getting_started")).toBe(true);
  });

  it("without intent, offers only after sustained engagement", () => {
    expect(shouldOfferLead(2, null)).toBe(false);
    expect(shouldOfferLead(ENGAGEMENT_TURNS - 1, null)).toBe(false);
    expect(shouldOfferLead(ENGAGEMENT_TURNS, null)).toBe(true);
  });

  it("never offers again once declined, captured, or already offered", () => {
    for (const state of ["declined", "captured", "offered"] as const) {
      setLeadState(state);
      expect(shouldOfferLead(10, "pricing")).toBe(false);
    }
  });

  it("state survives via sessionStorage and degrades safely without it", () => {
    setLeadState("declined");
    expect(getLeadState()).toBe("declined");
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(getLeadState()).toBe("none"); // worst case: one polite offer
  });

  it("detects the meaningful-intent moments and ignores ordinary questions", () => {
    expect(detectLeadIntent("How much does the Agency plan cost?")).toBe("pricing");
    expect(detectLeadIntent("How do I get started with Zybble?")).toBe("getting_started");
    expect(detectLeadIntent("Which plan should I pick for my agency?")).toBeTruthy();
    expect(detectLeadIntent("Can you send me a checklist?")).toBe("resource_request");
    expect(detectLeadIntent("What data comes with each lead?")).toBeNull();
    expect(detectLeadIntent("Where does the data come from?")).toBeNull();
  });

  it("submitAiLead resolves softly on network failure — never throws into the chat", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    const result = await submitAiLead({
      email: "person@example.com",
      page: "/",
      firstQuestion: "q",
      intent: "pricing",
      referrer: "",
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
    });
    expect(result.ok).toBe(false);
  });
});
