/* ------------------------------------------------------------------ */
/* Web3Forms — the one browser-side submission helper.                 */
/*                                                                     */
/* Web3Forms access keys are designed to be public (they only permit   */
/* sending a form to the inbox the key was created for), so the key    */
/* lives in src/lib/site.ts as ordinary provider configuration. The    */
/* Zybble AI lead endpoint (/api/ai-lead) submits server-side instead  */
/* and reads WEB3FORMS_ACCESS_KEY from the environment — this helper   */
/* is only for forms the visitor fills in directly (the contact page). */
/* ------------------------------------------------------------------ */
import { WEB3FORMS_KEY } from "./site";

const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

export type Web3FormResult =
  | { ok: true }
  | { ok: false; message?: string };

/**
 * Submit a payload to Web3Forms. Field values are passed through as-is;
 * the access key and JSON headers are added here so no caller duplicates
 * provider wiring. Network failures resolve to `{ ok: false }` — callers
 * decide how to present the error.
 */
export async function submitWeb3Form(
  fields: Record<string, string>,
): Promise<Web3FormResult> {
  try {
    const res = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ access_key: WEB3FORMS_KEY, ...fields }),
    });
    const data: { success?: boolean; message?: string } = await res
      .json()
      .catch(() => ({}));
    if (res.ok && data.success) return { ok: true };
    return { ok: false, message: typeof data.message === "string" ? data.message : undefined };
  } catch {
    return { ok: false };
  }
}

/** Shared, deliberately-simple email shape check used by every form. */
export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
