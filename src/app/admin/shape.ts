/* ------------------------------------------------------------------ */
/* Admin console — defensive readers for API JSON                      */
/*                                                                     */
/* The admin endpoints return database-shaped JSON. These helpers read */
/* it without `any` and without pretending a missing value is zero in  */
/* places where that would be a lie — `str()` returns "" and the UI    */
/* decides whether that means "—" or "unknown".                        */
/* ------------------------------------------------------------------ */
export type Row = Record<string, unknown>;

export function obj(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

export function arr(value: unknown): Row[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as Row[]) : [];
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function bool(value: unknown): boolean {
  return value === true;
}

/** `{status: count}` maps come back from jsonb_object_agg. */
export function counts(value: unknown): Record<string, number> {
  const source = obj(value);
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(source)) result[key] = num(raw);
  return result;
}
