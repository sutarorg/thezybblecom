// ============================================================================
// Razorpay REST client shared by the Vercel Functions.
//
// Extracted from api/billing.ts so the billing route and the admin
// reconciliation action talk to the provider through ONE implementation:
// same timeouts, same Basic auth, same "never leak the provider body into a
// customer-facing message" policy.
//
// The key secret is used only to sign the Basic auth header. It is never
// logged, never returned, and never reaches the browser.
//
// NOTE: imported with the emitted ".js" extension (see
// api/_tests/module-resolution.test.ts) because Vercel compiles api/**/*.ts to
// .js without rewriting import specifiers.
// ============================================================================
import { Buffer } from "node:buffer";
import { missingEnvMessage, readServerEnv } from "./supabase-server.js";

export type RazorpayJson = Record<string, unknown>;

export class RazorpayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "RazorpayError";
    this.status = status;
    this.code = code;
  }
}

export function requireRazorpayCredentials(label: string): { keyId: string; secret: string } {
  const keyId = readServerEnv("RAZORPAY_KEY_ID");
  const secret = readServerEnv("RAZORPAY_KEY_SECRET");
  if (!keyId || !secret) {
    const missing = [!keyId && "RAZORPAY_KEY_ID", !secret && "RAZORPAY_KEY_SECRET"].filter(Boolean) as string[];
    throw new RazorpayError(
      500,
      `Razorpay isn't configured on the ${label} server. ${missingEnvMessage(missing)} Add the missing server secret${missing.length > 1 ? "s" : ""}, then redeploy.`,
      "billing_config",
    );
  }
  return { keyId, secret };
}

/** True when both provider credentials are present (no value is revealed). */
export function hasRazorpayCredentials(): boolean {
  return Boolean(readServerEnv("RAZORPAY_KEY_ID") && readServerEnv("RAZORPAY_KEY_SECRET"));
}

/**
 * Call the Razorpay v1 API. Throws RazorpayError with a safe, generic message
 * on timeout / network failure / non-2xx; the provider's own body is logged
 * only as metadata, never surfaced.
 */
export async function razorpayRequest(
  path: string,
  init: RequestInit = {},
  label = "billing",
): Promise<RazorpayJson> {
  const { keyId, secret } = requireRazorpayCredentials(label);
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new RazorpayError(
      timedOut ? 504 : 502,
      timedOut ? "Our payment provider took too long to respond." : "Our payment provider couldn't be reached. Please try again shortly.",
      timedOut ? "provider_timeout" : "provider_unreachable",
    );
  }

  const bodyText = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    console.error("provider request", { provider: "razorpay", status: response.status, responseKind: bodyText ? "body" : "empty" });
    throw new RazorpayError(502, "Our payment provider couldn't complete that action.", "provider_error");
  }
  return body as RazorpayJson;
}
