import { normalizeLocation, type NormalizedLocation } from "./location.ts";

export type BusinessSize = "unknown" | "small" | "medium" | "enterprise";
export type BusinessSizeSource = "provider" | "website" | "unknown";

export type BusinessSizeResult = {
  business_size: BusinessSize;
  employee_count: number | null;
  business_size_source: BusinessSizeSource;
  business_size_confidence: number;
};

export function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

export function norm(value: unknown) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function domainOf(value: unknown) {
  const url = stringValue(value);
  if (!url) return null;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./i, "").toLowerCase();
    return host || null;
  } catch {
    return norm(url) || null;
  }
}

export function canonicalDedupeKey(result: Record<string, unknown>, normalized?: { website_domain?: string | null; phone_normalized?: string | null; name?: string | null; address?: string | null }) {
  const placeId = stringValue(result.place_id);
  const dataId = stringValue(result.data_id);
  const dataCid = result.data_cid != null ? String(result.data_cid).trim() : "";
  const kgmid = stringValue(result.kgmid);
  const domain = normalized?.website_domain ?? domainOf(result.website);
  const phone = normalized?.phone_normalized ?? (stringValue(result.phone) ? stringValue(result.phone).replace(/\D+/g, "") : "");
  const name = normalized?.name ?? stringValue(result.title) ?? stringValue(result.name);
  const address = normalized?.address ?? stringValue(result.address);
  if (placeId) return `place:${placeId}`;
  if (dataId) return `data:${dataId}`;
  if (dataCid) return `cid:${dataCid}`;
  if (kgmid) return `kgmid:${kgmid}`;
  if (domain) return `domain:${domain}`;
  if (phone) return `phone:${phone}`;
  return `nameaddr:${norm(name)}:${norm(address)}`;
}

export function businessSizeFromEmployeeCount(count: number | null, source: BusinessSizeSource): BusinessSizeResult {
  if (!count || count < 1) return { business_size: "unknown", employee_count: null, business_size_source: "unknown", business_size_confidence: 0 };
  const business_size: BusinessSize = count >= 250 ? "enterprise" : count >= 50 ? "medium" : "small";
  return {
    business_size,
    employee_count: count,
    business_size_source: source,
    business_size_confidence: source === "provider" ? 0.95 : 0.75,
  };
}

function parseEmployeeCountValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  const text = stringValue(value);
  if (!text) return null;
  const range = text.match(/(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)\s+(?:employees|staff|team members|people)/i);
  if (range) return Number(range[2].replace(/,/g, ""));
  const plus = text.match(/(\d[\d,]*)\s*\+\s+(?:employees|staff|team members|people)/i);
  if (plus) return Number(plus[1].replace(/,/g, ""));
  const plain = text.match(/(?:employees|staff|team members|people|team of)\D{0,16}(\d[\d,]*)|(?:^|\b)(\d[\d,]*)\s+(?:employees|staff|team members|people)\b/i);
  const raw = plain?.[1] ?? plain?.[2];
  return raw ? Number(raw.replace(/,/g, "")) : null;
}

export function businessSizeFromProvider(result: Record<string, unknown>): BusinessSizeResult {
  const directKeys = ["employee_count", "employees", "number_of_employees", "staff_count", "company_size"];
  for (const key of directKeys) {
    const count = parseEmployeeCountValue(result[key]);
    if (count) return businessSizeFromEmployeeCount(count, "provider");
  }
  const extensions = Array.isArray(result.extensions) ? result.extensions : [];
  for (const entry of extensions) {
    const group = objectValue(entry);
    const values = Array.isArray(group.values) ? group.values : [];
    for (const value of values) {
      const text = typeof value === "string" ? value : stringValue(objectValue(value).text);
      const count = parseEmployeeCountValue(text);
      if (count) return businessSizeFromEmployeeCount(count, "provider");
    }
  }
  return { business_size: "unknown", employee_count: null, business_size_source: "unknown", business_size_confidence: 0 };
}

export function businessSizeFromPublicText(text: string): BusinessSizeResult {
  const count = parseEmployeeCountValue(text.slice(0, 200_000));
  return businessSizeFromEmployeeCount(count, count ? "website" : "unknown");
}

export function normalizePopularTimes(value: unknown) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

export function normalizeAddressFromProvider(result: Record<string, unknown>, fallbackLocation?: string | null): NormalizedLocation {
  return normalizeLocation(result, fallbackLocation);
}

export function safePriceLevel(result: Record<string, unknown>): number | null {
  const numericPrice = Number(result.price_level);
  if (Number.isFinite(numericPrice) && numericPrice >= 1 && numericPrice <= 4) return numericPrice;
  const price = stringValue(result.price);
  if (/^\$+$/.test(price) && price.length <= 4) return price.length;
  return null;
}

export function publicEmailCandidates(result: Record<string, unknown>) {
  const emails = stringArray(result.emails);
  const contact = objectValue(result.contact);
  const fields = [result.email, ...emails, contact.email];
  return [...new Set(fields.map((x) => stringValue(x).toLowerCase()).filter((x) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)))];
}
