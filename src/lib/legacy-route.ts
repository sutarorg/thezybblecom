/**
 * Converts the route format used by the previous hash router into a safe,
 * first-class application path.
 *
 * A fragment is never sent to the server, so a host rewrite cannot repair a
 * URL such as `/overview#/find`. This needs to run in the browser before the
 * router decides which page to render.
 */
const HASH_ROUTE_ORIGIN = "https://legacy-route.invalid";

/**
 * Returns a clean same-origin route for a legacy `#/…` fragment.
 *
 * Normal in-page fragments such as `#pricing` are deliberately ignored. Only
 * fragments that encode a path are migrated, e.g.:
 *
 * - `#/find`             → `/find`
 * - `#/leads?status=new` → `/leads?status=new`
 */
export function legacyHashRouteToPath(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;

  try {
    const target = new URL(hash.slice(1), HASH_ROUTE_ORIGIN);

    // Do not allow a malformed `#//host` fragment to become an external URL.
    if (target.origin !== HASH_ROUTE_ORIGIN) return null;

    return `${target.pathname}${target.search}`;
  } catch {
    return null;
  }
}

/** Replace the current legacy hash URL without adding a history entry. */
export function replaceLegacyHashRoute() {
  const path = legacyHashRouteToPath(window.location.hash);
  if (!path) return false;

  window.history.replaceState(window.history.state, "", path);
  return true;
}
