import { ExpireOptions, type GlideClient } from '@valkey/valkey-glide';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { POST } from './+server.js';

const { mockFindMany, mockCreateChatStreamResponse, mockValidateCSRFToken, limits, store } =
  vi.hoisted(() => ({
    mockFindMany: vi.fn(),
    mockCreateChatStreamResponse: vi.fn(),
    mockValidateCSRFToken: vi.fn(),
    limits: {
      maxRequests: 2,
      windowSeconds: 60,
      maxConcurrentRequests: 2,
      maxQueryLength: 50,
      concurrencyLeaseSeconds: 300,
      concurrencyRetryAfterSeconds: 5,
    },
    store: {
      counters: new Map<string, number>(),
      expiries: new Map<string, number>(),
      failOn: null as string | null,
    },
  }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('$lib/server/db.js', () => ({
  db: { message: { findMany: mockFindMany } },
}));

vi.mock('$lib/server/auth', () => ({
  learnerAuth: { validateCSRFToken: mockValidateCSRFToken },
}));

vi.mock('$lib/server/chat', () => ({
  CHAT_RATE_LIMIT_NAMESPACE: 'ratelimit:chat:messages',
  CHAT_CONCURRENCY_NAMESPACE: 'concurrency:chat:messages',
  chatLimits: limits,
  createChatStreamResponse: mockCreateChatStreamResponse,
}));

// The limiter itself is not mocked: these tests drive the real fixed-window and concurrency helpers
// over a Valkey stand-in, so the statuses and headers come from real counters.
vi.mock('$lib/server/valkey.js', () => ({
  valkey: {
    incr: async (key: string) => {
      if (store.failOn === 'incr') {
        throw new Error('valkey down');
      }
      const next = (store.counters.get(key) ?? 0) + 1;
      store.counters.set(key, next);
      return next;
    },
    decr: async (key: string) => {
      const next = (store.counters.get(key) ?? 0) - 1;
      store.counters.set(key, next);
      return next;
    },
    expire: async (key: string, seconds: number, options?: { expireOption?: ExpireOptions }) => {
      if (!store.counters.has(key)) {
        return false;
      }
      if (options?.expireOption === ExpireOptions.HasNoExpiry && store.expiries.has(key)) {
        return false;
      }
      store.expiries.set(key, seconds);
      return true;
    },
    ttl: async (key: string) => {
      if (!store.counters.has(key)) {
        return -2;
      }
      return store.expiries.get(key) ?? -1;
    },
    del: async (keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        store.expiries.delete(key);
        if (store.counters.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    },
  } as unknown as GlideClient,
}));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};
silentLogger.child.mockReturnValue(silentLogger);

const mockRequestJson = vi.fn();

interface BuildEventOptions {
  user?: { id: string } | null;
}

const buildEvent = ({ user = { id: 'user-1' } }: BuildEventOptions = {}) =>
  ({
    locals: { logger: silentLogger, session: { user } },
    request: {
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'content-type') {
            return 'application/json';
          }
          if (name.toLowerCase() === 'x-csrf-token') {
            return 'csrf-token';
          }
          return null;
        },
      },
      json: mockRequestJson,
    },
  }) as unknown as Parameters<typeof POST>[0];

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  store.counters.clear();
  store.expiries.clear();
  store.failOn = null;
  limits.maxRequests = 2;
  limits.windowSeconds = 60;
  limits.maxConcurrentRequests = 2;
  limits.maxQueryLength = 50;
  mockValidateCSRFToken.mockResolvedValue(true);
  mockFindMany.mockResolvedValue([]);
  mockCreateChatStreamResponse.mockReturnValue(new Response(null, { status: 200 }));
  mockRequestJson.mockImplementation(async () => ({ query: 'What is photosynthesis?' }));
});

describe('POST /api/messages — request rate limit', () => {
  test('streams the answer for every request within the limit', async () => {
    const first = await POST(buildEvent());
    const second = await POST(buildEvent());

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(mockCreateChatStreamResponse).toHaveBeenCalledTimes(2);
  });

  test('returns 429 with a Retry-After header once the limit is passed', async () => {
    await POST(buildEvent());
    await POST(buildEvent());

    const response = await POST(buildEvent());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  test('reports the remaining window rather than a full window in Retry-After', async () => {
    await POST(buildEvent());
    await POST(buildEvent());
    store.expiries.set('ratelimit:chat:messages:user-1', 17);

    const response = await POST(buildEvent());

    expect(response.headers.get('Retry-After')).toBe('17');
  });

  test('makes no model, search, or history call on a denied request', async () => {
    await POST(buildEvent());
    await POST(buildEvent());
    vi.clearAllMocks();
    mockValidateCSRFToken.mockResolvedValue(true);

    await POST(buildEvent());

    expect(mockCreateChatStreamResponse).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test('denies before parsing the body, so an oversized flood costs no parse', async () => {
    await POST(buildEvent());
    await POST(buildEvent());
    mockRequestJson.mockClear();

    await POST(buildEvent());

    expect(mockRequestJson).not.toHaveBeenCalled();
  });

  test('counts each learner against their own limit', async () => {
    await POST(buildEvent());
    await POST(buildEvent());

    const response = await POST(buildEvent({ user: { id: 'user-2' } }));

    expect(response.status).toBe(200);
  });

  test('allows requests again once the window lapses', async () => {
    // The mocked stream never settles, so raise the pool to keep the concurrency cap out of the way
    // and leave the window as the only limit under test.
    limits.maxConcurrentRequests = 10;
    await POST(buildEvent());
    await POST(buildEvent());
    expect((await POST(buildEvent())).status).toBe(429);

    store.counters.delete('ratelimit:chat:messages:user-1');
    store.expiries.delete('ratelimit:chat:messages:user-1');

    expect((await POST(buildEvent())).status).toBe(200);
  });

  test('returns 503 and streams nothing when the counter cannot be read', async () => {
    store.failOn = 'incr';

    const response = await POST(buildEvent());

    expect(response.status).toBe(503);
    expect(mockCreateChatStreamResponse).not.toHaveBeenCalled();
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'Failed to apply the request rate limit',
    );
  });
});

describe('POST /api/messages — prompt size bound', () => {
  test('returns 413 and makes no model, search, or history call for an oversized prompt', async () => {
    mockRequestJson.mockResolvedValue({ query: 'x'.repeat(51) });

    const response = await POST(buildEvent());

    expect(response.status).toBe(413);
    expect(mockCreateChatStreamResponse).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test('accepts a prompt exactly at the maximum length', async () => {
    mockRequestJson.mockResolvedValue({ query: 'x'.repeat(50) });

    const response = await POST(buildEvent());

    expect(response.status).toBe(200);
  });

  test('takes no concurrency slot for a rejected prompt', async () => {
    mockRequestJson.mockResolvedValue({ query: 'x'.repeat(51) });

    await POST(buildEvent());

    expect(store.counters.has('concurrency:chat:messages:user-1')).toBe(false);
  });
});

describe('POST /api/messages — concurrency cap', () => {
  test('returns 429 with a Retry-After header once the learner fills the pool', async () => {
    limits.maxConcurrentRequests = 1;
    // The mocked stream never settles, so the first request keeps holding its slot.
    await POST(buildEvent());

    const response = await POST(buildEvent());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(mockCreateChatStreamResponse).toHaveBeenCalledTimes(1);
  });

  test('admits the next request once the held slot is released', async () => {
    limits.maxConcurrentRequests = 1;
    await POST(buildEvent());
    const { onSettled } = mockCreateChatStreamResponse.mock.calls[0][0];

    await onSettled();

    expect((await POST(buildEvent())).status).toBe(200);
  });

  test('releases the slot when the history lookup fails, so the learner is not locked out', async () => {
    limits.maxConcurrentRequests = 1;
    mockFindMany.mockRejectedValueOnce(new Error('db down'));

    const failed = await POST(buildEvent());
    const next = await POST(buildEvent());

    expect(failed.status).toBe(500);
    expect(next.status).toBe(200);
  });

  test('counts each learner against their own pool', async () => {
    limits.maxConcurrentRequests = 1;
    await POST(buildEvent());

    const response = await POST(buildEvent({ user: { id: 'user-2' } }));

    expect(response.status).toBe(200);
  });
});
