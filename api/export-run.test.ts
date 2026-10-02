import { describe, expect, it } from "vitest";
import { csvEscape } from "./export-run";

describe("csvEscape", () => {
  it("escapes commas quotes and line breaks", () => {
    expect(csvEscape("ACME, Inc.")).toBe('"ACME, Inc."');
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("serializes arrays and unicode", () => {
    expect(csvEscape(["vip", "followup"])).toBe("vip; followup");
    expect(csvEscape("Café")).toBe("Café");
    expect(csvEscape(null)).toBe("");
  });
});
