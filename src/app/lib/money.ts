/* ------------------------------------------------------------------ */
/* Zybble — money formatting.                                          */
/*                                                                     */
/* All Zybble prices are in US DOLLARS.                                */
/*                                                                     */
/*   • Site/app plan listings (PLANS in src/lib/site.ts) store whole    */
/*     dollars — format with `formatDollars` (49 → "$49").              */
/*                                                                     */
/*   • Backend billing (Paddle, `price_cents`, `amount_cents`) stores   */
/*     every amount in the SMALLEST currency unit of its billing       */
/*     currency (cents for USD). 4900 = $49.00. Format those with      */
/*     `formatMoney`. The actual billed currency comes from Paddle per  */
/*     row (`subscriptions.currency`, `payments.currency`); USD is the  */
/*     default. Historical rows created under the legacy billing       */
/*     provider keep their original currency and are formatted with    */
/*     whatever they recorded — nothing historical is rewritten.        */
/* ------------------------------------------------------------------ */

/** Default currency for billing amounts (Paddle / database). */
export const BILLING_CURRENCY = "USD" as const;

/** Currency plan prices are listed in on the marketing site and in-app. */
export const LIST_CURRENCY = "USD" as const;

/** Format a minor-unit amount, e.g. 4900 → "$49" (USD). */
export function formatMoney(minorUnits: number, currency: string = BILLING_CURRENCY): string {
  const amount = Number.isFinite(minorUnits) ? minorUnits / 100 : 0;
  const hasMinorUnits = Math.round(amount * 100) % 100 !== 0;
  const code = (currency || BILLING_CURRENCY).toUpperCase();
  const locale = code === "INR" ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: hasMinorUnits ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    const symbol = code === "INR" ? "₹" : "$";
    return `${symbol}${amount.toFixed(hasMinorUnits ? 2 : 0)}`;
  }
}

/** Format a whole-dollar plan price (what the marketing plan cards store), e.g. 49 → "$49". */
export function formatDollars(dollars: number): string {
  return formatMoney(Math.round(dollars * 100), LIST_CURRENCY);
}
