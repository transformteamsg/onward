/**
 * Decodes a request pathname the way the SvelteKit router does.
 *
 * A hook that gates behaviour on the pathname must compare the same value the router
 * matched the route with. `event.url.pathname` is the raw pathname and keeps its
 * percent-encoding, so a comparison against it can disagree with the resolved route.
 *
 * SvelteKit calls `decode_pathname` before it matches a route
 * (`@sveltejs/kit/src/utils/url.js`), which is
 * `pathname.split('%25').map(decodeURI).join('%25')`. This function mirrors it
 * exactly, for two reasons:
 *
 * 1. `decodeURI` leaves the reserved delimiters encoded, so `%2F` stays `%2F`. A
 *    caller cannot forge an extra path segment. `decodeURIComponent` would decode it
 *    and is the wrong tool here.
 * 2. Splitting on `%25` keeps an encoded percent sign intact, so `%2561dmin` decodes
 *    to `%61dmin` and not to `admin`. Without the split the value would decode twice.
 *
 * @param pathname a raw pathname, for example `event.url.pathname`
 * @returns the decoded pathname. Returns `null` when `pathname` holds a malformed
 *   percent-sequence such as `/%ZZ` or a lone `/%`, because `decodeURI` throws a
 *   `URIError` on those. SvelteKit catches the same failure and then matches no route
 *   at all, so a `null` result means the request cannot reach any route.
 */
export function decodeRoutePathname(pathname: string): string | null {
  try {
    return pathname.split('%25').map(decodeURI).join('%25');
  } catch {
    return null;
  }
}
