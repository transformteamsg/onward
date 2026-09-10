import { env } from '$env/dynamic/private';
import { resolvePositiveInt } from '$lib/server/ratelimit/index.js';

/**
 * The namespace for the per-learner request counter in Valkey.
 */
export const CHAT_RATE_LIMIT_NAMESPACE = 'ratelimit:chat:messages';
/**
 * The namespace for the per-learner in-flight completion counter in Valkey.
 */
export const CHAT_CONCURRENCY_NAMESPACE = 'concurrency:chat:messages';

/**
 * The number of requests one learner may send in a window, when
 * `CHAT_RATE_LIMIT_MAX_REQUESTS` is unset or invalid.
 */
const DEFAULT_MAX_REQUESTS = 20;
/**
 * The length of the request window in seconds, when `CHAT_RATE_LIMIT_WINDOW_SECONDS` is unset or
 * invalid.
 */
const DEFAULT_WINDOW_SECONDS = 60;
/**
 * The number of completions one learner may have in flight, when
 * `CHAT_MAX_CONCURRENT_REQUESTS` is unset or invalid.
 */
const DEFAULT_MAX_CONCURRENT_REQUESTS = 2;
/**
 * The largest accepted prompt in characters, when `CHAT_MAX_QUERY_LENGTH` is unset or invalid.
 */
const DEFAULT_MAX_QUERY_LENGTH = 2000;

/**
 * The lease on a concurrency slot, in seconds.
 *
 * A slot is released when the stream settles, so this only bounds a slot orphaned by a process that
 * died mid-stream. It is deliberately not configurable: it is a leak guard rather than a limit, and
 * it must stay well above the longest a completion can take.
 */
const CONCURRENCY_LEASE_SECONDS = 300;

/**
 * How long to tell a learner to wait when every one of their concurrency slots is busy. A held slot
 * has no window to lapse, so unlike the request limit there is no remaining time to report.
 */
const CONCURRENCY_RETRY_AFTER_SECONDS = 5;

/**
 * The cost and availability limits for the model-backed chat endpoint, resolved once at startup.
 *
 * Every value is read from an environment variable and falls back to the documented default when
 * the variable is unset or is not a positive integer. See `.env.example`.
 */
export const chatLimits = {
  /**
   * The number of requests one learner may send per window. Set `CHAT_RATE_LIMIT_MAX_REQUESTS`.
   */
  maxRequests: resolvePositiveInt(env.CHAT_RATE_LIMIT_MAX_REQUESTS, DEFAULT_MAX_REQUESTS),
  /**
   * The length of the request window, in seconds. Set `CHAT_RATE_LIMIT_WINDOW_SECONDS`.
   */
  windowSeconds: resolvePositiveInt(env.CHAT_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
  /**
   * The number of completions one learner may have in flight. Set `CHAT_MAX_CONCURRENT_REQUESTS`.
   */
  maxConcurrentRequests: resolvePositiveInt(
    env.CHAT_MAX_CONCURRENT_REQUESTS,
    DEFAULT_MAX_CONCURRENT_REQUESTS,
  ),
  /**
   * The largest accepted prompt, in characters. Set `CHAT_MAX_QUERY_LENGTH`.
   */
  maxQueryLength: resolvePositiveInt(env.CHAT_MAX_QUERY_LENGTH, DEFAULT_MAX_QUERY_LENGTH),
  concurrencyLeaseSeconds: CONCURRENCY_LEASE_SECONDS,
  concurrencyRetryAfterSeconds: CONCURRENCY_RETRY_AFTER_SECONDS,
};
