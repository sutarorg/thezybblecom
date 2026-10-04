/* ------------------------------------------------------------------ */
/* Zybble — money formatting.                                          */
/*                                                                     */
/* Plan prices listed on the site (PLANS in src/lib/site.ts) are in    */
/* US DOLLARS — whole-dollar amounts formatted with `formatDollars`.   */
/*                                                                     */
/* Backend billing (Razorpay, `price_cents`, `amount_cents`) stores    */
/* every amount in the SMALLEST currency unit of its billing currency  */
/* (currently paise). 4900 paise = ₹49.00. Format those with           */
/* `formatMoney`.                                                      */
/* ------------------------------------------------------------------ */

/** Currency backend amounts are billed in (Razorpay / database). */
export const BILLING_CURRENCY = "INR" as const;

/** Currency plan prices are listed in on the marketing site and in-app. */
export const LIST_CURRENCY = "USD" as const;

/** Format a minor-unit amount, e.g. 4900 → "₹49" (INR) or "$49" (USD). */
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
