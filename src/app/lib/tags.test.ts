import { describe, expect, it } from "vitest";
import { mergeTags, validateTag } from "./tags";

describe("tags", () => {
  it("accepts one-word tags", () => {
    expect(validateTag(" dentist ")).toEqual({ ok: true, tag: "dentist" });
    expect(validateTag("hotlead")).toEqual({ ok: true, tag: "hotlead" });
    expect(validateTag("follow_up")).toEqual({ ok: true, tag: "follow_up" });
  });

  it("rejects spaces and empty tags", () => {
    expect(validateTag("hot lead").ok).toBe(false);
    expect(validateTag("very important").ok).toBe(false);
    expect(validateTag("   ").ok).toBe(false);
  });

  it("deduplicates merged tags", () => {
    expect(mergeTags(["dentist"], ["Dentist", "priority"])).toEqual(["dentist", "priority"]);
  });
});
