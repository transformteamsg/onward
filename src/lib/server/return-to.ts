/**
 * A base URL that no request can ever come from. `resolveReturnTo` resolves a candidate
 * against it, so any candidate that reaches a different origin is not site-relative.
 * The host is under the reserved `.invalid` top-level domain, so it resolves nowhere.
 */
const SENTINEL_BASE = 'https://return-to.invalid';

/**
 * Resolves a post-login `return_to` candidate to a path on this origin.
 *
 * A `return_to` arrives as a query parameter, so an attacker controls it. Passed
 * straight to `redirect`, it sends a freshly signed-in user to any site the attacker
 * names. This function accepts a site-relative path only and falls back for everything
 * else.
 *
 * Three forms are rejected before the parse, because each one leaves this origin:
 *
 * 1. Anything that does not start with `/`, which covers an absolute URL such as
 *    `https://attacker.example/` and a scheme such as `javascript:`.
 * 2. A protocol-relative `//attacker.example`, which keeps the current scheme and
 *    changes the host.
 * 3. `/\attacker.example`, because a browser reads a backslash in the authority
 *    position as a slash and treats the value as protocol-relative.
 *
 * The parse against `SENTINEL_BASE` then catches every form the three checks above
 * miss. A URL parser strips leading whitespace and removes an embedded tab, newline,
 * and carriage return before it reads the authority, so `/\t/attacker.example` becomes
 * `//attacker.example`. Comparing the parsed origin catches those without this function
 * having to model the stripping rules itself.
 *
 * The return value is the parsed `pathname`, `search`, and `hash`, never the candidate
 * string. A browser parses the `Location` header with the same rules used here, so
 * returning the parsed form removes any gap between what this function judged and what
 * the browser will follow.
 *
 * The parse cannot throw for a candidate that passes the three checks above, because a
 * parser reads an authority only after `//` or `/\` and both are already rejected. The
 * guard stays because this function runs after a successful sign-in, where an
 * unexpected throw would turn a completed login into a 500.
 *
 * @param candidate a `return_to` value read out of the OAuth `state`. The state is JSON,
 *   so the value can be of any type, or absent.
 * @param fallback the path to use when `candidate` is not a site-relative path. Each
 *   realm passes its own: the learner app passes `HOME_PATH` and the admin app passes
 *   `/admin`. The caller owns this value, so it is returned unchecked.
 * @returns a path on this origin, always beginning with `/`.
 */
export function resolveReturnTo(candidate: unknown, fallback: string): string {
  if (typeof candidate !== 'string' || !candidate.startsWith('/')) {
    return fallback;
  }

  if (candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return fallback;
  }

  let resolved: URL;
  try {
    resolved = new URL(candidate, SENTINEL_BASE);
  } catch {
    return fallback;
  }

  if (resolved.origin !== SENTINEL_BASE) {
    return fallback;
  }

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
