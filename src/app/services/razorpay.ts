/* ------------------------------------------------------------------ */
/* Razorpay Standard Checkout — on-site overlay.                       */
/*                                                                     */
/* The entire payment experience stays on Zybble: the checkout.js      */
/* script renders Razorpay's own iframe modal over the current page.   */
/* We never navigate to, open, or even receive a hosted-page URL       */
/* (`short_url` / `auth_link` / `api.razorpay.com/v1/l/...`).          */
/*                                                                     */
/* Only the PUBLIC key id reaches the browser. The key secret,         */
/* signature verification and every database write are server-side.    */
/* ------------------------------------------------------------------ */
import type { CheckoutSession } from "./api";

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export type CheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
};

export type CheckoutOutcome =
  | { kind: "success"; result: CheckoutSuccess }
  | { kind: "dismissed" }
  | { kind: "failed"; message: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
type RazorpayInstance = {
  open: () => void;
  close?: () => void;
  on: (event: string, handler: (payload: any) => void) => void;
};
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

function globalRazorpay(): RazorpayConstructor | null {
  return (window as any).Razorpay ?? null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

let loader: Promise<RazorpayConstructor | null> | null = null;

/** Load checkout.js once, on demand (never on pages that don't need it). */
export function loadRazorpayCheckout(): Promise<RazorpayConstructor | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(null);
  const existing = globalRazorpay();
  if (existing) return Promise.resolve(existing);
  if (loader) return loader;

  loader = new Promise<RazorpayConstructor | null>((resolve) => {
    const previous = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = previous ?? document.createElement("script");
    const done = () => resolve(globalRazorpay());
    script.addEventListener("load", done, { once: true });
    script.addEventListener(
      "error",
      () => {
        loader = null;
        script.remove();
        resolve(null);
      },
      { once: true },
    );
    if (!previous) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return loader;
}

/**
 * Open the checkout overlay and resolve once the user finishes, fails, or
 * dismisses it. The promise resolves exactly once — `ondismiss` and the
 * handler/failure callbacks race, and later calls are ignored — so the retry
 * state in the UI can never be driven by a stale callback.
 */
export async function openRazorpayCheckout(session: CheckoutSession): Promise<CheckoutOutcome> {
  const Razorpay = await loadRazorpayCheckout();
  if (!Razorpay) {
    return {
      kind: "failed",
      message: "The secure payment window couldn't load. Check your connection or any ad blocker, then try again.",
    };
  }

  return new Promise<CheckoutOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const options: Record<string, unknown> = {
      key: session.keyId,
      subscription_id: session.subscriptionId,
      name: session.name,
      description: session.description,
      currency: session.currency,
      prefill: session.prefill,
      notes: session.notes,
      theme: { color: session.themeColor },
      // Keep the overlay anchored to this page; no redirect, no new tab.
      redirect: false,
      retry: { enabled: false },
      remember_customer: true,
      modal: {
        escape: true,
        confirm_close: true,
        ondismiss: () => settle({ kind: "dismissed" }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: (response: any) => {
        const paymentId = String(response?.razorpay_payment_id ?? "");
        const signature = String(response?.razorpay_signature ?? "");
        const subscriptionId = String(response?.razorpay_subscription_id ?? session.subscriptionId);
        if (!paymentId || !signature) {
          settle({
            kind: "failed",
            message: "The payment response was incomplete. If you were charged, refresh this page in a moment.",
          });
          return;
        }
        settle({ kind: "success", result: { razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, razorpay_signature: signature } });
      },
    };

    // Only restrict methods when the server actually told us to. An empty map
    // means "use whatever the Razorpay account has enabled".
    if (session.method && Object.keys(session.method).length > 0) {
      options.method = session.method;
    }

    const checkout = new Razorpay(options);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    checkout.on("payment.failed", (event: any) => {
      const description = event?.error?.description;
      settle({
        kind: "failed",
        message:
          typeof description === "string" && description.trim()
            ? description
            : "That payment didn't go through. No plan change was made — you can try again.",
      });
    });
    checkout.open();
  });
}
