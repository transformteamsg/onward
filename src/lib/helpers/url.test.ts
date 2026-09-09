import { describe, expect, test } from 'vitest';

import { isSafeHttpURL } from './url.js';

describe('isSafeHttpURL', () => {
  test('accepts an https URL', () => {
    expect(isSafeHttpURL('https://example.com/a?b=c#d')).toBe(true);
  });

  test('accepts an http URL', () => {
    expect(isSafeHttpURL('http://example.com')).toBe(true);
  });

  test('accepts an uppercase scheme', () => {
    expect(isSafeHttpURL('HTTPS://example.com')).toBe(true);
  });

  test('rejects a javascript URL', () => {
    expect(isSafeHttpURL('javascript:alert(document.cookie)')).toBe(false);
  });

  test('rejects a javascript URL with a mixed-case scheme', () => {
    expect(isSafeHttpURL('JaVaScRiPt:alert(1)')).toBe(false);
  });

  test('rejects a javascript URL padded with whitespace', () => {
    expect(isSafeHttpURL('  javascript:alert(1)  ')).toBe(false);
  });

  test('rejects a javascript URL split by a newline', () => {
    expect(isSafeHttpURL('java\nscript:alert(1)')).toBe(false);
  });

  test('rejects a data URL', () => {
    expect(isSafeHttpURL('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  test('rejects a vbscript URL', () => {
    expect(isSafeHttpURL('vbscript:msgbox(1)')).toBe(false);
  });

  test('rejects a file URL', () => {
    expect(isSafeHttpURL('file:///etc/passwd')).toBe(false);
  });

  test('rejects a relative path', () => {
    expect(isSafeHttpURL('/unit/123')).toBe(false);
  });

  test('rejects a string that is not a URL', () => {
    expect(isSafeHttpURL('not-a-url')).toBe(false);
  });

  test('rejects an empty string', () => {
    expect(isSafeHttpURL('')).toBe(false);
  });

  test('rejects a non-string value', () => {
    expect(isSafeHttpURL(null)).toBe(false);
    expect(isSafeHttpURL(undefined)).toBe(false);
    expect(isSafeHttpURL(42)).toBe(false);
  });
});
