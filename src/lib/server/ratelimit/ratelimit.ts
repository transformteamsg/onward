import { ExpireOptions, type GlideClient, Script } from '@valkey/valkey-glide';

/**
 * The options shared by every limiter in this module.
 *
 * `namespace` and `identifier` are joined into the Valkey key, so each caller owns a separate
 * keyspace and cannot disturb another caller's counters.
 */
export interface LimitScope {
  /**
   * The namespace prepended to the counter key, to avoid collisions with other data.
   *
   * Every limit is a separate budget and **must** be given its own namespace. Two limits that
   * share a namespace also share a counter, so one would consume the other's allowance.
   */
  namespace: string;
  /**
   * The subject the limit applies to, typically a user ID.
   */
  identifier: string;
}

export interface FixedWindowOptions extends LimitScope {
  /**
   * The number of requests allowed in one window. A request past this count is denied.
   */
  limit: number;
  /**
   * The length of the window, in seconds. The window starts on the first counted request and the
   * counter resets when it lapses.
   */
  windowSeconds: number;
}

export interface RateLimitDecision {
  /**
   * `true` when the request is within the limit, `false` when it is denied.
   */
  allowed: boolean;
  /**
   * The number of requests left in the current window. `0` on a denied request.
   */
  remaining: number;
  /**
   * The number of seconds until the window resets. Suitable for the `Retry-After` header. `0` on
   * an allowed request.
   */
  retryAfterSeconds: number;
}

export interface ConcurrencyOptions extends LimitScope {
  /**
   * The number of slots held at one time. An acquire past this count is refused.
   */
  limit: number;
  /**
   * The lifetime of the slot counter, in seconds.
   *
   * This is a leak guard rather than a limit: a process that dies while holding a slot never calls
   * `release`, so without an expiry the count would stay high and lock the subject out for good.
   * Set it above the longest expected hold time.
   */
  leaseSeconds: number;
}

export interface ConcurrencySlot {
  /**
   * `true` when a slot was taken, `false` when the limit was already reached.
   */
  acquired: boolean;
  /**
   * Returns the slot to the pool. Always safe to call, including on a refused acquire, so the
   * caller can release from a single `finally` branch.
   */
  release: () => Promise<void>;
}

function buildKey(scope: LimitScope): string {
  return `${scope.namespace}:${scope.identifier}`;
}

/**
 * Reads a positive integer from an environment variable, falling back to a default.
 *
 * A missing, empty, non-numeric, fractional, or non-positive value yields the fallback, so a
 * mistyped variable degrades to the documented default instead of disabling the limit.
 *
 * @param raw - The raw environment variable value.
 * @param fallback - The value to use when `raw` is not a positive integer.
 * @returns The parsed value, or `fallback`.
 */
export function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

/**
 * Counts one request against a fixed window and returns the decision.
 *
 * The counter lives in Valkey, so every application process shares one window per subject. The
 * window opens on the first counted request and the key expires when it lapses, which resets the
 * count.
 *
 * @param valkey - The Valkey client instance.
 * @param options - The scope of the limit, the request limit, and the window length.
 * @returns Whether the request is allowed, how much allowance is left, and when to retry.
 */
export async function consumeFixedWindow(
  valkey: GlideClient,
  options: FixedWindowOptions,
): Promise<RateLimitDecision> {
  const key = buildKey(options);

  const count = await valkey.incr(key);

  // Set the expiry on every request, not only the first. `HasNoExpiry` makes it a no-op once the
  // window is open, so this both opens the window and repairs a key left without an expiry by a
  // process that died between the increment and the expiry.
  await valkey.expire(key, options.windowSeconds, {
    expireOption: ExpireOptions.HasNoExpiry,
  });

  if (count <= options.limit) {
    return { allowed: true, remaining: options.limit - count, retryAfterSeconds: 0 };
  }

  // `ttl` reports -1 for a key with no expiry and -2 for a missing key; either is a genuine "no
  // window to wait out" case that falls back to a full window. `0` is a real, valid remainder (the
  // key is about to lapse), so it must not be folded into that fallback.
  const ttl = await valkey.ttl(key);

  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: ttl >= 0 ? ttl : options.windowSeconds,
  };
}

// Atomically decrements the concurrency counter and deletes it once it reaches zero, in one
// server-side step. A plain `decr` then `del` leaves a window where a concurrent `incr` landing
// between the two calls gets wiped out by the `del`; running both in one script closes that window.
const RELEASE_SLOT_SCRIPT = new Script(`
local remaining = redis.call('DECR', KEYS[1])
if remaining <= 0 then
  redis.call('DEL', KEYS[1])
end
return remaining
`);

async function releaseSlotKey(valkey: GlideClient, key: string): Promise<void> {
  await valkey.invokeScript(RELEASE_SLOT_SCRIPT, { keys: [key] });
}

/**
 * Takes one concurrency slot for the subject, if the pool has a free one.
 *
 * The count lives in Valkey, so slots held by every application process count against one pool per
 * subject. A refused acquire returns the slot it provisionally took, so a rejected request never
 * inflates the count.
 *
 * @param valkey - The Valkey client instance.
 * @param options - The scope of the limit, the slot limit, and the lease length.
 * @returns Whether a slot was taken, and the function that returns it.
 */
export async function acquireConcurrencySlot(
  valkey: GlideClient,
  options: ConcurrencyOptions,
): Promise<ConcurrencySlot> {
  const key = buildKey(options);

  const inFlight = await valkey.incr(key);

  if (inFlight > options.limit) {
    await valkey.decr(key);
    // Arm the lease only when the key has none, which repairs a key left without one by a process
    // that died between the increment and the expiry. `HasNoExpiry` makes this a no-op while a
    // crashed holder's lease still runs, so a denied retry cannot re-arm it and defeat the leak
    // guard. Without this repair a pool of one never recovers, because no later acquire is granted
    // and nothing else sets the expiry.
    await valkey.expire(key, options.leaseSeconds, {
      expireOption: ExpireOptions.HasNoExpiry,
    });
    return {
      acquired: false,
      // The caller holds nothing, so releasing must not decrement. A no-op keeps `release` safe to
      // call on every path.
      release: async () => {
        // Nothing to return to the pool.
      },
    };
  }

  // Refresh the lease only once the slot is actually granted. Refreshing it on a refusal too would
  // keep re-arming a crashed holder's lease on every denied retry, defeating the leak guard.
  try {
    await valkey.expire(key, options.leaseSeconds);
  } catch (err) {
    // The lease never got set, so this acquire never happened as far as the pool is concerned. Roll
    // the increment back rather than leave a phantom holder that a caller has no handle to release.
    await releaseSlotKey(valkey, key);
    throw err;
  }

  return {
    acquired: true,
    release: async () => releaseSlotKey(valkey, key),
  };
}
