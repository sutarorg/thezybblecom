export type StructuredLocationInput = {
  address?: unknown;
  street?: unknown;
  street_address?: unknown;
  city?: unknown;
  locality?: unknown;
  state?: unknown;
  region?: unknown;
  province?: unknown;
  postal_code?: unknown;
  zip?: unknown;
  country?: unknown;
  country_code?: unknown;
  address_components?: unknown;
};

export type NormalizedLocation = {
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  country_code: string | null;
};

const COUNTRY_ALIASES: Record<string, { country: string; code: string }> = {
  usa: { country: "United States", code: "US" },
  "u.s.a.": { country: "United States", code: "US" },
  "u.s.": { country: "United States", code: "US" },
  us: { country: "United States", code: "US" },
  "united states": { country: "United States", code: "US" },
  "united states of america": { country: "United States", code: "US" },
  uk: { country: "United Kingdom", code: "GB" },
  "u.k.": { country: "United Kingdom", code: "GB" },
  "united kingdom": { country: "United Kingdom", code: "GB" },
  england: { country: "United Kingdom", code: "GB" },
  india: { country: "India", code: "IN" },
  bharat: { country: "India", code: "IN" },
  canada: { country: "Canada", code: "CA" },
  australia: { country: "Australia", code: "AU" },
};

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const US_STATE_CODES = new Set(Object.values(US_STATE_NAMES));

const IN_STATES = new Set([
  "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat",
  "haryana", "himachal pradesh", "jharkhand", "karnataka", "kerala", "madhya pradesh", "maharashtra",
  "manipur", "meghalaya", "mizoram", "nagaland", "odisha", "orissa", "punjab", "rajasthan",
  "sikkim", "tamil nadu", "telangana", "tripura", "uttar pradesh", "uttarakhand", "west bengal",
  "delhi", "jammu and kashmir", "ladakh", "puducherry", "chandigarh",
]);

function s(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function titleCountry(raw: string): { country: string; code: string | null } {
  const known = COUNTRY_ALIASES[raw.trim().toLowerCase()];
  if (known) return known;
  const upper = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return { country: raw.trim(), code: upper };
  return { country: raw.trim(), code: null };
}

function readStructuredComponents(components: unknown): Partial<NormalizedLocation> {
  if (!Array.isArray(components)) return {};
  const out: Partial<NormalizedLocation> = {};
  for (const c of components) {
    if (!c || typeof c !== "object") continue;
    const rec = c as Record<string, unknown>;
    const types = Array.isArray(rec.types) ? rec.types.map(String) : [];
    const longName = s(rec.long_name) ?? s(rec.longName) ?? s(rec.name) ?? s(rec.value);
    const shortName = s(rec.short_name) ?? s(rec.shortName) ?? longName;
    if (!longName) continue;
    if (types.includes("street_number") || types.includes("route")) {
      out.street = [out.street, longName].filter(Boolean).join(" ") || null;
    }
    if (types.includes("locality") || types.includes("postal_town") || types.includes("sublocality")) {
      out.city ??= longName;
    }
    if (types.includes("administrative_area_level_1")) out.state = shortName ?? longName;
    if (types.includes("postal_code")) out.postal_code = longName;
    if (types.includes("country")) {
      out.country = longName;
      out.country_code = shortName?.toUpperCase() ?? null;
    }
  }
  return out;
}

function splitAddress(address: string): string[] {
  return address.split(",").map((p) => p.trim()).filter(Boolean);
}

function isLikelyCountry(part: string) {
  const key = part.toLowerCase().replace(/\.$/, "");
  return Boolean(COUNTRY_ALIASES[key]) || /^[A-Z]{2}$/i.test(part.trim());
}

function parseStatePostal(part: string, countryCode: string | null): { state: string | null; postal: string | null } {
  const trimmed = part.trim();
  if (!trimmed) return { state: null, postal: null };

  if (countryCode === "US") {
    const match = trimmed.match(/^(.*?)(?:\s+|,\s*)?(\d{5}(?:-\d{4})?)$/);
    const withoutPostal = match ? match[1].trim() : trimmed;
    const postal = match?.[2] ?? null;
    const code = withoutPostal.toUpperCase();
    if (US_STATE_CODES.has(code)) return { state: code, postal };
    const named = US_STATE_NAMES[withoutPostal.toLowerCase()];
    return { state: (named ?? withoutPostal) || null, postal };
  }

  if (countryCode === "IN") {
    const match = trimmed.match(/^(.*?)(?:\s+)?(\d{6})$/);
    const state = (match ? match[1] : trimmed).trim();
    return { state: state || null, postal: match?.[2] ?? null };
  }

  if (countryCode === "GB") {
    const postcode = trimmed.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[1]?.toUpperCase() ?? null;
    const rest = postcode ? trimmed.replace(new RegExp(postcode.replace(/\s+/, "\\s*"), "i"), "").trim() : trimmed;
    return { state: rest || null, postal: postcode };
  }

  const numericPostal = trimmed.match(/^(.*?)(?:\s+)?([A-Z0-9][A-Z0-9 -]{2,10})$/i);
  if (numericPostal && /\d/.test(numericPostal[2])) {
    return { state: numericPostal[1].trim() || null, postal: numericPostal[2].trim() };
  }
  return { state: trimmed, postal: null };
}

function countryFromLast(parts: string[]) {
  const last = parts.at(-1);
  if (!last || !isLikelyCountry(last)) return { country: null as string | null, code: null as string | null, rest: parts };
  const { country, code } = titleCountry(last);
  return { country, code, rest: parts.slice(0, -1) };
}

function inferCountryFromState(part: string): { country: string | null; code: string | null } {
  const stateBits = parseStatePostal(part, "US");
  if (stateBits.state && (US_STATE_CODES.has(stateBits.state) || US_STATE_NAMES[part.toLowerCase()])) {
    return { country: "United States", code: "US" };
  }
  const first = part.replace(/\d{6}$/, "").trim().toLowerCase();
  if (IN_STATES.has(first)) return { country: "India", code: "IN" };
  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(part)) return { country: "United Kingdom", code: "GB" };
  return { country: null, code: null };
}

function parseFreeform(address: string): NormalizedLocation {
  const original = address.trim();
  const parts = splitAddress(original);
  if (!parts.length) return emptyLocation(original);
  if (parts.length === 1) return { ...emptyLocation(original), street: original };

  const countryInfo = countryFromLast(parts);
  let country = countryInfo.country;
  let countryCode = countryInfo.code;
  const rest = countryInfo.rest;

  if (!country && rest.length >= 2) {
    const inferred = inferCountryFromState(rest.at(-1) ?? "");
    country = inferred.country;
    countryCode = inferred.code;
  }

  let street: string | null = null;
  let city: string | null = null;
  let state: string | null = null;
  let postal: string | null = null;

  if (countryCode === "GB") {
    const last = rest.at(-1) ?? "";
    const postcode = last.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[1]?.toUpperCase() ?? null;
    if (postcode) {
      postal = postcode;
      const cityPart = last.replace(new RegExp(postcode.replace(/\s+/, "\\s*"), "i"), "").trim();
      city = cityPart || rest.at(-2) || null;
      street = rest.slice(0, cityPart ? -1 : -2).join(", ") || null;
    }
  }

  if (!city && countryCode === "GB") {
    city = rest.at(-1) ?? null;
    street = rest.slice(0, -1).join(", ") || null;
    state = null;
    postal = null;
  }

  if (!city) {
    const statePart = rest.at(-1) ?? "";
    const parsedState = parseStatePostal(statePart, countryCode);
    state = parsedState.state;
    postal = parsedState.postal;
    city = rest.at(-2) ?? null;
    street = rest.slice(0, -2).join(", ") || (rest.length === 2 ? rest[0] : null);
  }

  // If no country was stated and the pattern looks like "Street, City, ST ZIP",
  // infer US only from an actual state-code/state-name signal, never by default.
  if (!country && state) {
    const code = state.toUpperCase();
    if (US_STATE_CODES.has(code) || US_STATE_NAMES[state.toLowerCase()]) {
      country = "United States";
      countryCode = "US";
      state = US_STATE_CODES.has(code) ? code : US_STATE_NAMES[state.toLowerCase()];
    }
  }

  return {
    address: original,
    street: street || null,
    city: city || null,
    state: state || null,
    postal_code: postal || null,
    country,
    country_code: countryCode,
  };
}

function emptyLocation(address: string | null = null): NormalizedLocation {
  return { address, street: null, city: null, state: null, postal_code: null, country: null, country_code: null };
}

export function normalizeLocation(input: StructuredLocationInput, fallbackLocation?: string | null): NormalizedLocation {
  const address = s(input.address) ?? s((input as Record<string, unknown>).full_address) ?? null;
  const parsed = address ? parseFreeform(address) : emptyLocation(null);
  const structured = readStructuredComponents(input.address_components);
  const countryRaw = s(input.country) ?? structured.country ?? parsed.country;
  const countryCodeRaw = s(input.country_code) ?? structured.country_code ?? parsed.country_code;
  const countryKnown = countryRaw ? titleCountry(countryRaw) : null;
  const country = countryKnown?.country ?? countryRaw ?? null;
  const country_code = (countryCodeRaw ?? countryKnown?.code ?? parsed.country_code ?? null)?.toUpperCase() ?? null;

  return {
    address,
    street: s(input.street) ?? s(input.street_address) ?? structured.street ?? parsed.street,
    city: s(input.city) ?? s(input.locality) ?? structured.city ?? parsed.city ?? (fallbackLocation ? fallbackLocation.split(",")[0]?.trim() || null : null),
    state: s(input.state) ?? s(input.region) ?? s(input.province) ?? structured.state ?? parsed.state,
    postal_code: s(input.postal_code) ?? s(input.zip) ?? structured.postal_code ?? parsed.postal_code,
    country,
    country_code,
  };
}
