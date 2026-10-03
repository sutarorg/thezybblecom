import { describe, expect, it } from "vitest";
import { BUSINESS_NAME_MAX, truncateBusinessName } from "./text";

describe("truncateBusinessName", () => {
  it("returns short names unchanged", () => {
    expect(truncateBusinessName("Short Cafe")).toBe("Short Cafe");
  });

  it("returns a name of exactly 26 characters unchanged", () => {
    const exact = "A".repeat(BUSINESS_NAME_MAX);
    expect(exact.length).toBe(26);
    expect(truncateBusinessName(exact)).toBe(exact);
  });

  it("truncates names longer than 26 characters and appends an ellipsis", () => {
    const long = "Superduper Extraordinarily Longitudinal Artisanal Roastery";
    const out = truncateBusinessName(long);
    expect(out.endsWith("...")).toBe(true);
    expect(out.length).toBe(BUSINESS_NAME_MAX + 3);
    expect(out).toBe(`${long.slice(0, BUSINESS_NAME_MAX)}...`);
  });

  it("uses a custom limit when provided", () => {
    expect(truncateBusinessName("The Blue Door Bakery", 8)).toBe("The Blue...");
  });

  it("never lets the ellipsis dangle after whitespace", () => {
    // The 26-character cut lands exactly on a space — it is trimmed before "...".
    const name = `${"A".repeat(25)} Bakery & Sons`;
    expect(name.length).toBeGreaterThan(BUSINESS_NAME_MAX);
    const out = truncateBusinessName(name);
    expect(out.endsWith(" ...")).toBe(false);
    expect(out).toBe(`${"A".repeat(25)}...`);
  });

  it("counts emoji as one character and never splits a surrogate pair", () => {
    const name = `${"☕".repeat(30)} Roasters`;
    const out = truncateBusinessName(name);
    expect(out).toBe(`${"☕".repeat(BUSINESS_NAME_MAX)}...`);
    expect(Array.from(out).length).toBe(BUSINESS_NAME_MAX + 3);
    // No lone surrogate code units in the output.
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("trims surrounding whitespace of names that fit", () => {
    expect(truncateBusinessName("  Corner Deli  ")).toBe("Corner Deli");
  });
});
