const SAFE_URL_PROTOCOLS = ['http:', 'https:'];

/**
 * Reports whether a string is an absolute URL with a web-navigable scheme.
 *
 * `new URL()` alone accepts every scheme, including `javascript:` and `data:`,
 * so a value that only parses is not safe to put in an `href`. Use this
 * function for any author-supplied URL, both when it is stored and when it is
 * rendered.
 *
 * @param value - The candidate URL string.
 * @returns `true` when the value parses and its scheme is `http:` or `https:`.
 *
 * @example
 * ```typescript
 * import { isSafeHttpURL } from '$lib/helpers/index.js';
 *
 * isSafeHttpURL('https://example.com'); // true
 * isSafeHttpURL('javascript:alert(1)'); // false
 * ```
 */
export function isSafeHttpURL(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return SAFE_URL_PROTOCOLS.includes(url.protocol);
}
