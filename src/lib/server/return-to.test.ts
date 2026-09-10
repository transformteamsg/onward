import { describe, expect, test } from 'vitest';

import { resolveReturnTo } from './return-to.js';

const FALLBACK = '/home';

describe('resolveReturnTo', () => {
  test('returns a site-relative path unchanged', () => {
    expect(resolveReturnTo('/unit/42', FALLBACK)).toBe('/unit/42');
  });

  test('keeps the query string and the fragment', () => {
    expect(resolveReturnTo('/unit/42?tab=notes#top', FALLBACK)).toBe('/unit/42?tab=notes#top');
  });

  test('falls back for an absolute URL on another origin', () => {
    expect(resolveReturnTo('https://attacker.example/onward-login', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a protocol-relative URL', () => {
    expect(resolveReturnTo('//attacker.example/onward-login', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a backslash authority, which a browser reads as two slashes', () => {
    expect(resolveReturnTo('/\\attacker.example', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a slash-backslash authority', () => {
    expect(resolveReturnTo('/\\/attacker.example', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a tab between the slashes, which a URL parser removes', () => {
    expect(resolveReturnTo('/\t/attacker.example', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a newline between the slashes', () => {
    expect(resolveReturnTo('/\n/attacker.example', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a non-http scheme', () => {
    expect(resolveReturnTo('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a path-relative value, which is not site-relative', () => {
    expect(resolveReturnTo('attacker.example', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for an empty string', () => {
    expect(resolveReturnTo('', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back when the value is absent from the state', () => {
    expect(resolveReturnTo(undefined, FALLBACK)).toBe(FALLBACK);
  });

  test('falls back when the value is not a string', () => {
    expect(resolveReturnTo({ toString: () => '/home' }, FALLBACK)).toBe(FALLBACK);
  });

  test('resolves a parent-directory segment, so the result stays on this origin', () => {
    expect(resolveReturnTo('/unit/42/../../admin', FALLBACK)).toBe('/admin');
  });

  test('leaves an encoded slash encoded, so no caller can forge an authority', () => {
    expect(resolveReturnTo('/%2F%2Fattacker.example', FALLBACK)).toBe('/%2F%2Fattacker.example');
  });

  test('returns the caller fallback, so each realm keeps its own landing path', () => {
    expect(resolveReturnTo('https://attacker.example', '/admin')).toBe('/admin');
  });

  test('falls back for a dot segment that collapses into a protocol-relative path', () => {
    expect(resolveReturnTo('/.//attacker.example', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a parent-directory segment that collapses the same way', () => {
    expect(resolveReturnTo('/..//attacker.example', FALLBACK)).toBe(FALLBACK);
  });

  test('falls back for a dot segment combined with a backslash, which also collapses', () => {
    expect(resolveReturnTo('/.//\\attacker.example', FALLBACK)).toBe(FALLBACK);
  });
});
