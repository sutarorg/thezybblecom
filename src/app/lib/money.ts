/* ------------------------------------------------------------------ */
/* Zybble — money formatting.                                          */
/*                                                                     */
/* Zybble bills in INR only. Every amount that crosses Razorpay, the   */
/* database (`price_cents`, `amount_cents`) or this module is stored   */
/* in the SMALLEST currency unit — paise. 4900 paise = ₹49.00.         */
/* ------------------------------------------------------------------ */

export const BILLING_CURRENCY = "INR" as const;

/** Format a paise amount as Indian Rupees, e.g. 4900 → "₹49". */
export function formatMoney(minorUnits: number, currency: string = BILLING_CURRENCY): string {
  const amount = Number.isFinite(minorUnits) ? minorUnits / 100 : 0;
  const hasPaise = Math.round(amount * 100) % 100 !== 0;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: (currency || BILLING_CURRENCY).toUpperCase(),
      minimumFractionDigits: hasPaise ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `₹${amount.toFixed(hasPaise ? 2 : 0)}`;
  }
}

/** Format a whole-rupee amount (what the marketing plan cards store). */
export function formatRupees(rupees: number): string {
  return formatMoney(Math.round(rupees * 100));
}
