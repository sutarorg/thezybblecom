// ============================================================================
// Paddle.js wrapper — the ONLY billing code that runs in the browser.
//
// Uses the official @paddle/paddle-js package with the CLIENT-SIDE token
// (VITE_PADDLE_CLIENT_TOKEN). That token is intentionally public — it can
// only open checkouts for the prices this Paddle account offers. The Paddle
// API key, the webhook secret and the price-id → plan mapping are
// server-only and are NEVER imported here (see api/_lib/paddle.ts).
//
// The flow is deliberately indirect so the browser is never trusted:
//   1. The app asks /api/billing {action:"checkout"} for the next plan.
//   2. The server validates the upgrade ladder and returns the PUBLIC price
//      id, a server-generated checkout token and its Paddle environment.
//   3. This module opens Paddle Checkout with those values only.
//   4. On checkout.completed the app calls /api/billing {action:"sync",
//      transactionId} — the SERVER re-reads the transaction and subscription
//      from Paddle and applies the entitlement. A browser claim alone never
//      grants anything.
// ============================================================================
import {
  CheckoutEventNames,
  type CheckoutOpenOptions,
  type Paddle,
  type PaddleEventData,
  initializePaddle,
} from "@paddle/paddle-js";

export type PaddleEnvironment = "sandbox" | "production";

export type CheckoutResult =
  | { status: "completed"; transactionId: string }
  | { status: "closed" }
  | { status: "error"; message: string };

/* One checkout at a time; the shared Paddle event callback dispatches here. */
type ActiveCheckout = {
  onCompleted: (transactionId: string) => void;
  onClosed: () => void;
  onError: (message: string) => void;
};
let activeCheckout: ActiveCheckout | null = null;

let paddlePromise: Promise<Paddle | undefined> | null = null;
let initializedEnvironment: PaddleEnvironment | null = null;

/**
 * The environment the browser should load, from VITE_PADDLE_ENVIRONMENT
 * (e.g. "sandbox"). Falls back to the client-token prefix: test_… → sandbox,
 * live_… → production. Sandbox and live credentials must never be mixed,
 * so the browser environment is checked against the server's before the
 * overlay opens.
 */
export function browserPaddleEnvironment(): PaddleEnvironment {
  const raw = (import.meta.env.VITE_PADDLE_ENVIRONMENT ?? "").toString().trim().toLowerCase();
  if (raw === "sandbox" || raw === "test") return "sandbox";
  if (raw === "production" || raw === "live") return "production";
  const token = (import.meta.env.VITE_PADDLE_CLIENT_TOKEN ?? "").toString();
  return token.startsWith("test_") ? "sandbox" : "production";
}

/** True when the browser has the public client-side token configured. */
export function paddleClientConfigured(): boolean {
  return Boolean((import.meta.env.VITE_PADDLE_CLIENT_TOKEN ?? "").toString().trim());
}

/**
 * Initialize Paddle.js once with the PUBLIC client-side token. The promise is
 * shared, so repeated checkout attempts reuse the same instance. The event
 * callback only DISPATCHES — no entitlement is ever granted from an event.
 */
async function ensurePaddle(): Promise<Paddle | undefined> {
  const token = (import.meta.env.VITE_PADDLE_CLIENT_TOKEN ?? "").toString().trim();
  if (!token) return undefined;
  const environment = browserPaddleEnvironment();
  if (paddlePromise && initializedEnvironment === environment) return paddlePromise;

  paddlePromise = initializePaddle({
    environment,
    token,
    eventCallback: (event: PaddleEventData) => {
      const active = activeCheckout;
      if (!active) return;
      switch (event.name) {
        case CheckoutEventNames.CHECKOUT_COMPLETED: {
          const transactionId = String(event.data?.transaction_id ?? "");
          if (transactionId) active.onCompleted(transactionId);
          break;
        }
        case CheckoutEventNames.CHECKOUT_CLOSED:
          active.onClosed();
          break;
        case CheckoutEventNames.CHECKOUT_ERROR:
          active.onError("Paddle Checkout couldn't be opened. Please try again.");
          break;
        default:
          /* checkout.payment.failed keeps the overlay open so the customer
             can retry with another method — nothing to resolve here. */
          break;
      }
    },
  });
  initializedEnvironment = environment;
  return paddlePromise;
}

/**
 * Open a Paddle Checkout overlay on the current page.
 *
 * `options` carries ONLY browser-safe values the server prepared: the public
 * price id, the customer email, the server-generated checkout token
 * (customData) and the environment. The browser cannot pick a price the
 * server didn't hand it, and the checkout token is only ever resolved
 * against the user who created it server-side.
 *
 * Resolves when the checkout completes, the customer closes the overlay, or
 * checkout.error fires. A completed checkout is still only a HINT — the
 * caller must run the server-side sync before showing a new plan.
 */
export async function openPaddleCheckout(options: {
  priceId: string;
  customerEmail: string;
  checkoutToken: string;
  environment: PaddleEnvironment | string;
  successUrl?: string;
}): Promise<CheckoutResult> {
  if (!paddleClientConfigured()) {
    return {
      status: "error",
      message: "Payments aren't configured in this browser build. Ask the site owner to set VITE_PADDLE_CLIENT_TOKEN.",
    };
  }

  const serverEnvironment = String(options.environment ?? "").trim().toLowerCase();
  const browserEnvironment = browserPaddleEnvironment();
  if (serverEnvironment && serverEnvironment !== browserEnvironment) {
    return {
      status: "error",
      message:
        browserEnvironment === "sandbox"
          ? "This app is currently pointing at the Paddle sandbox, but the checkout was prepared for the live environment. Ask the site owner to check the Paddle environment settings."
          : "This app is currently pointing at live Paddle, but the checkout was prepared for the sandbox. Ask the site owner to check the Paddle environment settings.",
    };
  }

  const paddle = await ensurePaddle();
  if (!paddle?.Initialized) {
    paddlePromise = null;
    initializedEnvironment = null;
    return { status: "error", message: "Paddle Checkout couldn't be initialized. Please try again." };
  }

  return new Promise<CheckoutResult>((resolve) => {
    let settled = false;
    const finish = (result: CheckoutResult) => {
      if (settled) return;
      settled = true;
      activeCheckout = null;
      resolve(result);
    };

    activeCheckout = {
      onCompleted: (transactionId) => finish({ status: "completed", transactionId }),
      onClosed: () => finish({ status: "closed" }),
      onError: (message) => finish({ status: "error", message }),
    };

    /* Safety net: never leave the UI stuck on "opening checkout" forever
       (e.g. a browser extension swallowed the overlay). */
    const timeout = window.setTimeout(() => finish({ status: "closed" }), 15 * 60 * 1000);
    const originalCompleted = activeCheckout.onCompleted;
    const originalClosed = activeCheckout.onClosed;
    activeCheckout.onCompleted = (transactionId) => {
      window.clearTimeout(timeout);
      originalCompleted(transactionId);
    };
    activeCheckout.onClosed = () => {
      window.clearTimeout(timeout);
      originalClosed();
    };

    const checkoutOptions: CheckoutOpenOptions = {
      items: [{ priceId: options.priceId, quantity: 1 }],
      customer: options.customerEmail ? { email: options.customerEmail } : undefined,
      customData: { zybble_token: options.checkoutToken },
      settings: {
        theme: "light",
        displayMode: "overlay",
        allowLogout: false,
        showAddDiscounts: false,
        showAddTaxId: false,
        ...(options.successUrl ? { successUrl: options.successUrl } : {}),
      },
    };

    try {
      paddle.Checkout.open(checkoutOptions);
    } catch {
      window.clearTimeout(timeout);
      finish({ status: "error", message: "Paddle Checkout couldn't be opened. Please try again." });
    }
  });
}

/** Close any open checkout overlay (used on navigation/unmount). */
export function closePaddleCheckout(): void {
  void (async () => {
    const paddle = await ensurePaddle().catch(() => undefined);
    try {
      paddle?.Checkout.close();
    } catch {
      /* no overlay open */
    }
  })();
}
