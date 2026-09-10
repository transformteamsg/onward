import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { mockFindUnique, mockGet, mockSet, silentLogger } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);

  return {
    mockFindUnique: vi.fn(),
    mockGet: vi.fn(),
    mockSet: vi.fn(),
    silentLogger: logger,
  };
});

vi.mock('../db', () => ({ db: { user: { findUnique: mockFindUnique } } }));
vi.mock('../logger', () => ({ logger: silentLogger }));
vi.mock('../valkey', () => ({ valkey: { get: mockGet, set: mockSet } }));

import { getBase64EncodedAvatar } from './avatar.js';

const AVATAR_URL = 'https://lh3.googleusercontent.com/a/avatar';

const mockFetch = vi.fn();

/**
 * Builds a response whose body is a stream of the given chunks, so a test can control how much of
 * the body the reader sees before the size cap rejects it.
 */
function streamedResponse(chunks: Uint8Array[], init: ResponseInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return new Response(body, init);
}

beforeEach(() => {
  mockGet.mockResolvedValue(null);
  mockSet.mockResolvedValue('OK');
  mockFindUnique.mockResolvedValue({ avatarURL: AVATAR_URL });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('getBase64EncodedAvatar', () => {
  test('returns the cached avatar without fetching it again', async () => {
    mockGet.mockResolvedValue('data:image/png;base64,Y2FjaGVk');

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBe('data:image/png;base64,Y2FjaGVk');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('caches an image response under the media type the host reported', async () => {
    mockFetch.mockResolvedValue(
      new Response(Buffer.from('png-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/png; charset=binary' },
      }),
    );

    const avatar = await getBase64EncodedAvatar('user-1');

    expect(avatar).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`);
    expect(mockSet).toHaveBeenCalledWith('avatar:user-1', avatar, expect.anything());
  });

  test.each([
    ['a host outside the allowlist', 'https://evil.example.com/a/avatar'],
    ['a host that only suffixes an allowed domain', 'https://notgoogleusercontent.com/a/avatar'],
    ['a scheme that is not HTTPS', 'http://lh3.googleusercontent.com/a/avatar'],
    ['a URL that does not parse', 'not-a-url'],
  ])('does not fetch %s', async (_case, avatarURL) => {
    mockFindUnique.mockResolvedValue({ avatarURL });

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('fetches a subdomain of an allowed domain', async () => {
    mockFindUnique.mockResolvedValue({ avatarURL: 'https://lh6.googleusercontent.com/a/avatar' });
    mockFetch.mockResolvedValue(
      new Response(Buffer.from('jpeg-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBe(
      `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`,
    );
  });

  test('bounds the fetch with a timeout and returns null when the host does not respond', async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(20));

    mockFetch.mockImplementation(
      (_input: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('returns null when the declared size is over the cap, without reading the body', async () => {
    const oversized = streamedResponse([new Uint8Array(1024)], {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': String(4 * 1024 * 1024),
      },
    });
    mockFetch.mockResolvedValue(oversized);

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('returns null when a streamed body grows past the cap', async () => {
    const chunk = new Uint8Array(512 * 1024);
    const chunks = [chunk, chunk, chunk, chunk, chunk];
    mockFetch.mockResolvedValue(
      streamedResponse(chunks, { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('accepts a body that sits on the cap', async () => {
    const body = new Uint8Array(2 * 1024 * 1024);
    mockFetch.mockResolvedValue(
      streamedResponse([body], { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    await expect(getBase64EncodedAvatar('user-1')).resolves.toContain('data:image/png;base64,');
  });

  test('returns null on a non-OK status', async () => {
    mockFetch.mockResolvedValue(
      new Response('not found', { status: 404, headers: { 'content-type': 'image/png' } }),
    );

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test.each([
    ['an error page', 'text/html'],
    ['a media type that is only the image prefix', 'image/'],
  ])('returns null for %s', async (_case, contentType) => {
    mockFetch.mockResolvedValue(
      new Response('<html>error</html>', { status: 200, headers: { 'content-type': contentType } }),
    );

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('returns null when no content type is reported, with no image/jpeg default', async () => {
    const resp = new Response(Buffer.from('bytes'), { status: 200 });
    resp.headers.delete('content-type');
    mockFetch.mockResolvedValue(resp);

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('returns null when the response carries no body', async () => {
    mockFetch.mockResolvedValue(
      new Response(null, { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('returns null when the body fails part way through the read', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.error(new Error('connection reset'));
      },
    });
    mockFetch.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('returns null when the fetch itself fails', async () => {
    mockFetch.mockRejectedValue(new TypeError('network error'));

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('returns null when the user has no avatar URL', async () => {
    mockFindUnique.mockResolvedValue({ avatarURL: null });

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns null when the user is not found', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(getBase64EncodedAvatar('user-1')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
