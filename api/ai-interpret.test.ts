import { describe, expect, it } from "vitest";
import { cleanInterpretResult } from "./ai-interpret";

const base = {
  category: "dentists",
  location: "Austin",
  quantity: 100,
  minRating: "4",
  priceLevel: null,
  requireWebsite: true,
  requirePhone: false,
  requireEmail: false,
  openNow: false,
  summary: "Austin dentists with websites and strong ratings.",
  notes: [],
};

describe("AI interpretation validation", () => {
  it("clamps filters and keeps an explicitly requested business size", () => {
    const result = cleanInterpretResult(
      { ...base, quantity: 500, businessSize: "medium" },
      "Find medium-sized dentists in Austin",
    );
    expect(result.filters).toMatchObject({ category: "dentists", quantity: 240, businessSize: "medium" });
  });

  it("drops a business size the user did not request", () => {
    const result = cleanInterpretResult(
      { ...base, businessSize: "enterprise" },
      "Find 100 dentists in Austin with websites and 4+ ratings",
    );
    expect(result.filters).not.toHaveProperty("businessSize");
  });
});
