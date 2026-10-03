import { describe, expect, it } from "vitest";
import {
  businessSizeFromProvider,
  businessSizeFromPublicText,
  canonicalDedupeKey,
  normalizeOpenState,
  publicEmailCandidates,
  safePriceLevel,
} from "./search-core";

describe("search core", () => {
  it("uses provider identifiers before weak identity signals", () => {
    expect(canonicalDedupeKey({ place_id: "abc", title: "Name" })).toBe("place:abc");
    expect(canonicalDedupeKey({ data_id: "d1", title: "Name" })).toBe("data:d1");
    expect(canonicalDedupeKey({ data_cid: 123, title: "Name" })).toBe("cid:123");
  });

  it("falls back to domain/phone/name+address deterministically", () => {
    expect(canonicalDedupeKey({ website: "https://www.example.com/path" })).toBe("domain:example.com");
    expect(canonicalDedupeKey({ phone: "+1 (555) 100-2000" })).toBe("phone:15551002000");
    expect(canonicalDedupeKey({ title: "A Business", address: "10 Main" })).toBe("nameaddr:abusiness:10main");
  });

  it("maps price levels from symbols", () => {
    expect(safePriceLevel({ price: "$$" })).toBe(2);
    expect(safePriceLevel({ price_level: 3 })).toBe(3);
  });

  it("classifies business size only from explicit employee evidence", () => {
    expect(businessSizeFromProvider({ employees: "12 employees" }).business_size).toBe("small");
    expect(businessSizeFromPublicText("Our team includes 120 employees across offices.").business_size).toBe("medium");
    expect(businessSizeFromPublicText("We serve many customers but publish no staff count.").business_size).toBe("unknown");
  });
});

describe("open-state normalization (api/search-run.ts + provider shapes)", () => {
  it("treats open-now states as open even when they mention closing times", () => {
    for (const value of ["Open", "Open · Closes 9 PM", "Open · Closes 10 PM", "Currently open", "Open 24 hours", "Open ⋅ Closes 9PM", "Closes 9 PM"]) {
      expect(normalizeOpenState(value), `“${value}” must be open`).toBe("open");
    }
  });

  it("treats closed states as closed even when they mention opening times", () => {
    for (const value of ["Closed", "Closed · Opens 8 AM", "Closed ⋅ Opens 8AM Mon", "Temporarily closed", "Permanently closed", "Opens 8 AM"]) {
      expect(normalizeOpenState(value), `“${value}” must be closed`).toBe("closed");
    }
  });

  it("never marks a business closed merely because the text contains “close”", () => {
    expect(normalizeOpenState("Open · Closes 9 PM")).toBe("open");
    expect(normalizeOpenState("Open · Closing soon")).toBe("open");
    expect(normalizeOpenState("We close at 9 PM — currently open")).toBe("open");
  });

  it("returns unknown for absent or non-string values", () => {
    expect(normalizeOpenState("")).toBe("unknown");
    expect(normalizeOpenState("   ")).toBe("unknown");
    expect(normalizeOpenState(null)).toBe("unknown");
    expect(normalizeOpenState(undefined)).toBe("unknown");
    expect(normalizeOpenState(42)).toBe("unknown");
    expect(normalizeOpenState({ state: "Open" })).toBe("unknown");
  });
});

describe("provider public-email candidates (real response shapes)", () => {
  it("collects emails from `email`, `emails[]`, and `contact.email`", () => {
    expect(publicEmailCandidates({ email: "Howdy@Example.com " })).toEqual(["howdy@example.com"]);
    expect(publicEmailCandidates({ emails: ["a@example.com", "not-an-email"] })).toEqual(["a@example.com"]);
    expect(publicEmailCandidates({ contact: { email: "hi@example.com", phone: "512" } })).toEqual(["hi@example.com"]);
    expect(
      publicEmailCandidates({
        email: "FrontDesk@Example.com",
        emails: ["frontdesk@example.com", "team@example.com"],
        contact: { email: "team@example.com" },
      })
    ).toEqual(["frontdesk@example.com", "team@example.com"]);
  });

  it("never fabricates an email for shapes without one", () => {
    expect(publicEmailCandidates({})).toEqual([]);
    expect(publicEmailCandidates({ title: "No Email Bakery" })).toEqual([]);
    expect(publicEmailCandidates({ email: "broken@@example" })).toEqual([]);
    expect(publicEmailCandidates({ emails: "not-an-array" })).toEqual([]);
  });
});
