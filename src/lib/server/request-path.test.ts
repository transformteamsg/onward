import { describe, expect, test } from 'vitest';

import { decodeRoutePathname } from './request-path.js';

describe('decodeRoutePathname', () => {
  test('returns an unencoded pathname unchanged', () => {
    expect(decodeRoutePathname('/admin/unit/new')).toBe('/admin/unit/new');
  });

  test('decodes an encoded character so the result matches the routed path', () => {
    expect(decodeRoutePathname('/%61dmin/unit/new')).toBe('/admin/unit/new');
  });

  test('leaves an encoded slash encoded, so no caller can forge a path segment', () => {
    expect(decodeRoutePathname('/%2Fadmin')).toBe('/%2Fadmin');
  });

  test('does not decode twice, so an encoded percent sign round-trips', () => {
    expect(decodeRoutePathname('/%2561dmin')).toBe('/%2561dmin');
  });

  test('decodes a space, which is a legitimate encoded character', () => {
    expect(decodeRoutePathname('/a%20b')).toBe('/a b');
  });

  test('decodes a multi-byte UTF-8 sequence', () => {
    expect(decodeRoutePathname('/%E2%9C%93')).toBe('/✓');
  });

  test('returns null for an invalid hex digit pair', () => {
    expect(decodeRoutePathname('/%ZZ')).toBeNull();
  });

  test('returns null for a truncated percent sequence', () => {
    expect(decodeRoutePathname('/%')).toBeNull();
  });
});
