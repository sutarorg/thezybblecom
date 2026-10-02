import { describe, expect, it } from "vitest";
import { normalizeLocation } from "./location";

describe("normalizeLocation", () => {
  it("parses complex Indian addresses without treating floor numbers as city/state", () => {
    const out = normalizeLocation({ address: "201, 1st Floor, 1443, Kaustubh (Gore) Apts, Bajirao Rd, near Janata Bank, Mandai, Shukrawar Peth, Pune, Maharashtra 411002, India" });
    expect(out.city).toBe("Pune");
    expect(out.state).toBe("Maharashtra");
    expect(out.postal_code).toBe("411002");
    expect(out.country).toBe("India");
    expect(out.country_code).toBe("IN");
  });

  it("parses US addresses", () => {
    const out = normalizeLocation({ address: "123 Main St, Sacramento, CA 95814, USA" });
    expect(out.street).toBe("123 Main St");
    expect(out.city).toBe("Sacramento");
    expect(out.state).toBe("CA");
    expect(out.postal_code).toBe("95814");
    expect(out.country_code).toBe("US");
  });

  it("parses UK addresses", () => {
    const out = normalizeLocation({ address: "10 Downing St, London SW1A 2AA, UK" });
    expect(out.street).toBe("10 Downing St");
    expect(out.city).toBe("London");
    expect(out.postal_code).toBe("SW1A 2AA");
    expect(out.country_code).toBe("GB");
  });

  it("keeps apartment/floor details in the street", () => {
    const out = normalizeLocation({ address: "Apt 5B, 200 Market St, San Francisco, CA 94105, United States" });
    expect(out.street).toBe("Apt 5B, 200 Market St");
    expect(out.city).toBe("San Francisco");
    expect(out.state).toBe("CA");
  });

  it("handles missing postal codes", () => {
    const out = normalizeLocation({ address: "221B Baker Street, London, United Kingdom" });
    expect(out.city).toBe("London");
    expect(out.postal_code).toBeNull();
    expect(out.country_code).toBe("GB");
  });

  it("prefers provider structured fields", () => {
    const out = normalizeLocation({
      address: "messy address",
      city: "Structured City",
      state: "Structured State",
      postal_code: "12345",
      country: "India",
    });
    expect(out.city).toBe("Structured City");
    expect(out.state).toBe("Structured State");
    expect(out.country_code).toBe("IN");
  });

  it("handles malformed addresses", () => {
    const out = normalizeLocation({ address: "Just Some Place" });
    expect(out.street).toBe("Just Some Place");
    expect(out.city).toBeNull();
  });
});
