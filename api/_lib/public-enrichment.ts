import dns from "node:dns/promises";
import net from "node:net";
import { businessSizeFromPublicText, domainOf, type BusinessSizeResult } from "./search-core";

const MAX_BYTES = 750_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const EMAIL_RE = /(?<![\w.%+-])([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?![\w.%+-])/gi;

function isPrivateIp(ip: string) {
  if (net.isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower === "::";
  }
  return true;
}

async function assertPublicHost(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported URL protocol");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Private host blocked");
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((r) => isPrivateIp(r.address))) throw new Error("Private network blocked");
}

function normalizeWebsite(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function fetchLimited(url: URL, redirects = 0): Promise<{ text: string; finalUrl: URL; contentType: string }> {
  await assertPublicHost(url);
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2",
      "User-Agent": "ZybbleBot/1.0 (+https://zybble.com)",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect without location");
    return fetchLimited(new URL(location, url), redirects + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw new Error("Unsupported content type");
  }
  const reader = response.body?.getReader();
  if (!reader) return { text: await response.text(), finalUrl: url, contentType };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      chunks.push(value.slice(0, Math.max(0, value.byteLength - (total - MAX_BYTES))));
      break;
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString("utf8"), finalUrl: url, contentType };
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&commat;|&#64;/gi, "@")
    .replace(/\s+\[at\]\s+|\s+\(at\)\s+/gi, "@")
    .replace(/\s+\[dot\]\s+|\s+\(dot\)\s+/gi, ".")
    .replace(/<[^>]+>/g, " ");
}

function extractEmails(text: string, websiteDomain: string | null) {
  const normalized = stripHtml(text).toLowerCase();
  const out = new Set<string>();
  for (const match of normalized.matchAll(EMAIL_RE)) {
    const email = match[1].replace(/^mailto:/, "").replace(/[.,;:]+$/, "");
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) continue;
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(email)) continue;
    const local = email.split("@")[0];
    if (["example", "test", "invalid", "noreply", "no-reply"].includes(local)) continue;
    if (websiteDomain) {
      const emailDomain = email.split("@")[1].replace(/^www\./, "");
      const siteRoot = websiteDomain.replace(/^www\./, "");
      // Prefer same-domain public addresses. Permit subdomains both ways.
      if (emailDomain !== siteRoot && !emailDomain.endsWith(`.${siteRoot}`) && !siteRoot.endsWith(`.${emailDomain}`)) {
        continue;
      }
    }
    out.add(email);
  }
  return [...out].slice(0, 8);
}

function contactUrls(base: URL) {
  const paths = ["/", "/contact", "/contact-us", "/about", "/about-us", "/locations"];
  return paths.map((path) => new URL(path, base));
}

export async function enrichPublicWebsite(website: string | null | undefined): Promise<{
  emails: string[];
  employeeSize: BusinessSizeResult;
  pagesChecked: number;
}> {
  const base = normalizeWebsite(website);
  if (!base) return { emails: [], employeeSize: { business_size: "unknown", employee_count: null, business_size_source: "unknown", business_size_confidence: 0 }, pagesChecked: 0 };
  const siteDomain = domainOf(base.toString());
  const emails = new Set<string>();
  let combinedText = "";
  let pagesChecked = 0;
  for (const url of contactUrls(base)) {
    try {
      const page = await fetchLimited(url);
      pagesChecked++;
      combinedText += `\n${page.text.slice(0, 200_000)}`;
      for (const email of extractEmails(page.text, siteDomain)) emails.add(email);
      if (emails.size >= 4 && combinedText.length > 20_000) break;
    } catch {
      // Public enrichment is opportunistic per page; no fabricated fallback.
    }
  }
  return {
    emails: [...emails],
    employeeSize: businessSizeFromPublicText(combinedText),
    pagesChecked,
  };
}
