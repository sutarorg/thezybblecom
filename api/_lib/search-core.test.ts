import { describe, expect, it } from "vitest";
import { businessSizeFromProvider, businessSizeFromPublicText, canonicalDedupeKey, safePriceLevel } from "./search-core";

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
