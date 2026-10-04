// ============================================================================
// Best-effort request governor for the authenticated AI routes.
//
// Why this exists: /api/ai-analyze and /api/ai-interpret call a paid model on
// every request, and neither one is metered by a plan allowance — `has_ai` is
// a boolean, and `increment_usage_counter(ai_runs)` is recorded but never
// enforced. `ai-analyze` additionally accepts `refresh: true`, which bypasses
// the ai_insights cache, so a single signed-in Free account could loop one
// lead and spend OpenRouter credit without limit.
//
// Scope and honesty about it: Vercel Functions scale horizontally and warm
// instances are recycled, so an in-memory window is a GOVERNOR, not a hard
// quota — it bounds the damage one client can do through one instance and
// absorbs double-clicks and retry storms. A hard, cross-instance quota needs
// shared state (a usage allowance in Postgres or a KV store); that is tracked
// as a deliberate follow-up rather than faked here.
//
// Keyed on the authenticated user id, not the IP: abuse of these routes
// requires a session, and one office behind a single NAT address must not be
// throttled as if it were one person.
// ============================================================================

type Bucket = { reset: number; count: number };

const windows = new Map<string, Map<string, Bucket>>();

/** Keep the per-instance map from growing without bound. */
function sweep(buckets: Map<string, Bucket>, now: number) {
  if (buckets.size <= 5_000) return;
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
}

/**
 * Record one request against `key` in the named window.
 * Returns true when the caller has exceeded `max` requests in `windowMs`.
 */
export function consumeRateLimit(
  name: string,
  key: string,
  options: { max: number; windowMs: number },
): boolean {
  const now = Date.now();
  let buckets = windows.get(name);
  if (!buckets) {
    buckets = new Map<string, Bucket>();
    windows.set(name, buckets);
  }
  sweep(buckets, now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    buckets.set(key, { reset: now + options.windowMs, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > options.max;
}

/** Test seam — resets the governor between cases. */
export function resetRateLimits() {
  windows.clear();
}
