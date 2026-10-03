import { describe, expect, it } from "vitest";
// The Supabase Edge Functions run on Deno and cannot be imported by vitest,
// but the shared open-state module is dependency-free. Importing it here and
// running it against the same matrix as api/_lib/search-core.ts guarantees the
// Vercel and Edge Function pipelines normalize open state identically.
import { normalizeOpenState as edgeNormalizeOpenState } from "./open-state.ts";
import { normalizeOpenState as vercelNormalizeOpenState } from "../../../api/_lib/search-core.js";

const PROVIDER_OPEN_STATE_SHAPES: Array<[unknown, "open" | "closed" | "unknown"]> = [
  ["Open", "open"],
  ["Open · Closes 9 PM", "open"],
  ["Open · Closes 10 PM", "open"],
  ["Open 24 hours", "open"],
  ["Currently open", "open"],
  ["Closed", "closed"],
  ["Closed · Opens 8 AM", "closed"],
  ["Closed ⋅ Opens 8AM Mon", "closed"],
  ["Temporarily closed", "closed"],
  ["Permanently closed", "closed"],
  ["Opens 8 AM", "closed"],
  ["Closes 9 PM", "open"],
  ["", "unknown"],
  [null, "unknown"],
  [undefined, "unknown"],
  [1234, "unknown"],
];

describe("edge-function open-state normalization", () => {
  it("matches the Vercel implementation for every real provider shape", () => {
    for (const [value] of PROVIDER_OPEN_STATE_SHAPES) {
      expect(edgeNormalizeOpenState(value)).toEqual(vercelNormalizeOpenState(value));
    }
  });

  it("applies the required production mapping", () => {
    const expected = new Map(PROVIDER_OPEN_STATE_SHAPES);
    for (const [value, state] of PROVIDER_OPEN_STATE_SHAPES) {
      expect(edgeNormalizeOpenState(value)).toBe(expected.get(value) ?? state);
    }
  });

  it("does not treat “close” in the text as closed by itself", () => {
    expect(edgeNormalizeOpenState("Open · Closes 9 PM")).toBe("open");
    expect(edgeNormalizeOpenState("Permanently closed")).toBe("closed");
  });
});
