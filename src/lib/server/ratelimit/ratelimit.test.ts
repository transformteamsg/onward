import { ExpireOptions, type GlideClient } from '@valkey/valkey-glide';
import { beforeEach, describe, expect, test } from 'vitest';

import { acquireConcurrencySlot, consumeFixedWindow, resolvePositiveInt } from './ratelimit.js';

const counters = new Map<string, number>();
const expiries = new Map<string, number>();

/**
 * A Valkey stand-in over the two module-level maps. Every client built from it shares those maps,
 * which is what lets a test assert the cross-process behaviour of the counters.
 */
interface ClientOverrides {
  failExpireOnce?: boolean;
}

function buildClient(overrides: ClientOverrides = {}): GlideClient {
  return {
    incr: async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    decr: async (key: string) => {
      const next = (counters.get(key) ?? 0) - 1;
      counters.set(key, next);
      return next;
    },
    expire: async (key: string, seconds: number, options?: { expireOption?: ExpireOptions }) => {
      if (overrides.failExpireOnce) {
        overrides.failExpireOnce = false;
        throw new Error('valkey down');
      }
      if (!counters.has(key)) {
        return false;
      }
      if (options?.expireOption === ExpireOptions.HasNoExpiry && expiries.has(key)) {
        return false;
      }
      expiries.set(key, seconds);
      return true;
    },
    ttl: async (key: string) => {
      if (!counters.has(key)) {
        return -2;
      }
      return expiries.get(key) ?? -1;
    },
    del: async (keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        expiries.delete(key);
        if (counters.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    },
    // Mirrors RELEASE_SLOT_SCRIPT's atomic decrement-then-conditional-delete: this stand-in runs
    // both steps synchronously against the shared maps, so it is atomic by construction here too.
    invokeScript: async (_script: unknown, options?: { keys?: string[] }) => {
      const key = options?.keys?.[0];
      if (key === undefined) {
        throw new Error('invokeScript requires a key');
      }
      const next = (counters.get(key) ?? 0) - 1;
      counters.set(key, next);
      if (next <= 0) {
        counters.delete(key);
        expiries.delete(key);
      }
      return next;
    },
  } as unknown as GlideClient;
}

const valkey = buildClient();

const WINDOW = {
  namespace: 'ratelimit:test',
  identifier: 'user-1',
  limit: 3,
  windowSeconds: 60,
};

const POOL = {
  namespace: 'concurrency:test',
  identifier: 'user-1',
  limit: 2,
  leaseSeconds: 120,
};

/**
 * Drops a key the way a Valkey expiry does, so a test can put the window past its end without
 * waiting for real time to pass.
 */
function lapse(key: string) {
  counters.delete(key);
  expiries.delete(key);
}

beforeEach(() => {
  counters.clear();
  expiries.clear();
});

describe('resolvePositiveInt', () => {
  test('returns the parsed value when the variable holds a positive integer', () => {
    expect(resolvePositiveInt('45', 20)).toBe(45);
  });

  test('returns the fallback when the variable is unset', () => {
    expect(resolvePositiveInt(undefined, 20)).toBe(20);
  });

  test('returns the fallback when the variable is blank', () => {
    expect(resolvePositiveInt('   ', 20)).toBe(20);
  });

  test('returns the fallback when the variable is not a number', () => {
    expect(resolvePositiveInt('many', 20)).toBe(20);
  });

  test('returns the fallback when the variable is fractional', () => {
    expect(resolvePositiveInt('2.5', 20)).toBe(20);
  });

  test('returns the fallback when the variable is zero or negative', () => {
    expect(resolvePositiveInt('0', 20)).toBe(20);
    expect(resolvePositiveInt('-5', 20)).toBe(20);
  });
});

describe('consumeFixedWindow — allow', () => {
  test('allows the first request and reports the remaining allowance', async () => {
    const decision = await consumeFixedWindow(valkey, WINDOW);

    expect(decision).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
  });

  test('allows every request up to the limit and counts the allowance down to zero', async () => {
    const first = await consumeFixedWindow(valkey, WINDOW);
    const second = await consumeFixedWindow(valkey, WINDOW);
    const third = await consumeFixedWindow(valkey, WINDOW);

    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
    expect([first.remaining, second.remaining, third.remaining]).toEqual([2, 1, 0]);
  });

  test('opens the window on the first request and does not extend it on a later one', async () => {
    await consumeFixedWindow(valkey, WINDOW);
    expiries.set('ratelimit:test:user-1', 12);

    await consumeFixedWindow(valkey, WINDOW);

    expect(expiries.get('ratelimit:test:user-1')).toBe(12);
  });

  test('counts each identifier against its own window', async () => {
    await consumeFixedWindow(valkey, WINDOW);
    await consumeFixedWindow(valkey, WINDOW);
    await consumeFixedWindow(valkey, WINDOW);

    const other = await consumeFixedWindow(valkey, { ...WINDOW, identifier: 'user-2' });

    expect(other).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
  });
});

describe('consumeFixedWindow — deny', () => {
  test('denies the request past the limit and reports the window remainder as the retry delay', async () => {
    for (let i = 0; i < 3; i += 1) {
      await consumeFixedWindow(valkey, WINDOW);
    }
    expiries.set('ratelimit:test:user-1', 41);

    const decision = await consumeFixedWindow(valkey, WINDOW);

    expect(decision).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 41 });
  });

  test('falls back to a full window as the retry delay when the key carries no expiry', async () => {
    for (let i = 0; i < 3; i += 1) {
      await consumeFixedWindow(valkey, WINDOW);
    }
    expiries.delete('ratelimit:test:user-1');

    const decision = await consumeFixedWindow(valkey, WINDOW);

    expect(decision.retryAfterSeconds).toBe(60);
  });

  test('reports a near-zero retry delay rather than a full window when the key is about to lapse', async () => {
    for (let i = 0; i < 3; i += 1) {
      await consumeFixedWindow(valkey, WINDOW);
    }
    expiries.set('ratelimit:test:user-1', 0);

    const decision = await consumeFixedWindow(valkey, WINDOW);

    expect(decision.retryAfterSeconds).toBe(0);
  });

  test('keeps denying every further request in the same window', async () => {
    for (let i = 0; i < 4; i += 1) {
      await consumeFixedWindow(valkey, WINDOW);
    }

    const decision = await consumeFixedWindow(valkey, WINDOW);

    expect(decision.allowed).toBe(false);
  });
});

describe('consumeFixedWindow — window reset', () => {
  test('allows the request again once the window lapses', async () => {
    for (let i = 0; i < 4; i += 1) {
      await consumeFixedWindow(valkey, WINDOW);
    }
    lapse('ratelimit:test:user-1');

    const decision = await consumeFixedWindow(valkey, WINDOW);

    expect(decision).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
  });

  test('opens a fresh window with a full expiry after the previous one lapses', async () => {
    await consumeFixedWindow(valkey, WINDOW);
    lapse('ratelimit:test:user-1');

    await consumeFixedWindow(valkey, WINDOW);

    expect(expiries.get('ratelimit:test:user-1')).toBe(60);
  });
});

describe('consumeFixedWindow — shared across processes', () => {
  test('a second client over the same store is denied once the first has spent the window', async () => {
    const processA = buildClient();
    const processB = buildClient();

    await consumeFixedWindow(processA, WINDOW);
    await consumeFixedWindow(processA, WINDOW);
    await consumeFixedWindow(processA, WINDOW);
    const decision = await consumeFixedWindow(processB, WINDOW);

    expect(decision.allowed).toBe(false);
  });

  test('counts requests from two clients against one shared allowance', async () => {
    const processA = buildClient();
    const processB = buildClient();

    await consumeFixedWindow(processA, WINDOW);
    const decision = await consumeFixedWindow(processB, WINDOW);

    expect(decision.remaining).toBe(1);
  });
});

describe('acquireConcurrencySlot', () => {
  test('grants a slot while the pool has a free one', async () => {
    const first = await acquireConcurrencySlot(valkey, POOL);
    const second = await acquireConcurrencySlot(valkey, POOL);

    expect([first.acquired, second.acquired]).toEqual([true, true]);
  });

  test('refuses a slot once the pool is full', async () => {
    await acquireConcurrencySlot(valkey, POOL);
    await acquireConcurrencySlot(valkey, POOL);

    const third = await acquireConcurrencySlot(valkey, POOL);

    expect(third.acquired).toBe(false);
  });

  test('leaves the count untouched when it refuses, so a refused acquire never fills the pool', async () => {
    await acquireConcurrencySlot(valkey, POOL);
    await acquireConcurrencySlot(valkey, POOL);

    await acquireConcurrencySlot(valkey, POOL);

    expect(counters.get('concurrency:test:user-1')).toBe(2);
  });

  test('grants a slot again after a holder releases', async () => {
    const first = await acquireConcurrencySlot(valkey, POOL);
    await acquireConcurrencySlot(valkey, POOL);
    expect((await acquireConcurrencySlot(valkey, POOL)).acquired).toBe(false);

    await first.release();

    expect((await acquireConcurrencySlot(valkey, POOL)).acquired).toBe(true);
  });

  test('clears the key once the last holder releases', async () => {
    const slot = await acquireConcurrencySlot(valkey, POOL);

    await slot.release();

    expect(counters.has('concurrency:test:user-1')).toBe(false);
  });

  test('releasing a refused slot does not decrement the count', async () => {
    await acquireConcurrencySlot(valkey, POOL);
    await acquireConcurrencySlot(valkey, POOL);
    const refused = await acquireConcurrencySlot(valkey, POOL);

    await refused.release();

    expect(counters.get('concurrency:test:user-1')).toBe(2);
  });

  test('refreshes the lease on every acquire, so it outlives the newest holder', async () => {
    await acquireConcurrencySlot(valkey, POOL);
    expiries.set('concurrency:test:user-1', 3);

    await acquireConcurrencySlot(valkey, POOL);

    expect(expiries.get('concurrency:test:user-1')).toBe(120);
  });

  test('holds a separate pool for each identifier', async () => {
    await acquireConcurrencySlot(valkey, POOL);
    await acquireConcurrencySlot(valkey, POOL);

    const other = await acquireConcurrencySlot(valkey, { ...POOL, identifier: 'user-2' });

    expect(other.acquired).toBe(true);
  });

  test('a second client over the same store is refused once the first has filled the pool', async () => {
    const processA = buildClient();
    const processB = buildClient();

    await acquireConcurrencySlot(processA, POOL);
    await acquireConcurrencySlot(processA, POOL);
    const refused = await acquireConcurrencySlot(processB, POOL);

    expect(refused.acquired).toBe(false);
  });

  test('does not refresh the lease on a refused acquire, so a denied retry cannot revive a crashed holder', async () => {
    await acquireConcurrencySlot(valkey, POOL);
    await acquireConcurrencySlot(valkey, POOL);
    expiries.set('concurrency:test:user-1', 3);

    const refused = await acquireConcurrencySlot(valkey, POOL);

    expect(refused.acquired).toBe(false);
    expect(expiries.get('concurrency:test:user-1')).toBe(3);
  });

  test('rolls back the increment when the lease refresh fails, leaving no phantom holder', async () => {
    const failingClient = buildClient({ failExpireOnce: true });

    await expect(acquireConcurrencySlot(failingClient, POOL)).rejects.toThrow('valkey down');

    expect(counters.has('concurrency:test:user-1')).toBe(false);
  });

  test('a granted slot can still be taken again after a prior acquire on the same key failed its lease refresh', async () => {
    const failingClient = buildClient({ failExpireOnce: true });
    await expect(acquireConcurrencySlot(failingClient, POOL)).rejects.toThrow('valkey down');

    const first = await acquireConcurrencySlot(valkey, POOL);
    const second = await acquireConcurrencySlot(valkey, POOL);

    expect([first.acquired, second.acquired]).toEqual([true, true]);
  });
});
