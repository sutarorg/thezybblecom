/* ------------------------------------------------------------------ */
/* Single-line business-name display truncation                        */
/*                                                                     */
/* Lead rows render business names next to avatars, ratings and        */
/* contact chips. A name far longer than surrounding content can       */
/* crowd (or, without a shrinkable flex track, overlap) its neighbors. */
/* Every public lead-name label therefore goes through                  */
/* `truncateBusinessName`: names longer than BUSINESS_NAME_MAX chars   */
/* render as "First 26 characters..." and the complete name always     */
/* travels next to it in a title/aria attribute. Two layers of         */
/* defense — this helper guarantees the 26-character contract; CSS     */
/* (`min-width: 0`, `overflow: hidden`, `white-space: nowrap`,         */
/* `text-overflow: ellipsis`, i.e. Tailwind `min-w-0` + `truncate`)    */
/* still handles containers that are narrower than 26 characters.      */
/* ------------------------------------------------------------------ */

/** Maximum business-name characters shown before an ellipsis is appended. */
export const BUSINESS_NAME_MAX = 26;

/**
 * Returns `name` unchanged when it fits; otherwise the first `max`
 * characters followed by an ASCII ellipsis ("...").
 *
 * Operates on code points (not UTF-16 units) so multi-byte characters such
 * as emoji in real business names can never be split in half, and trims
 * trailing whitespace at the cut so the ellipsis never floats after a gap.
 */
export function truncateBusinessName(name: string, max = BUSINESS_NAME_MAX): string {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= max) return trimmed;
  return `${chars.slice(0, max).join("").trimEnd()}...`;
}
