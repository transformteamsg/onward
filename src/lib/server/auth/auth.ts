import { timingSafeEqual } from 'node:crypto';

import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { GlideClient } from '@valkey/valkey-glide';

import { env } from '$env/dynamic/private';
import { nanoid } from '$lib/helpers/index.js';

import { parseDuration, unmask } from './helpers/index.js';
import Session, { type AdminUser, type User } from './session.js';

type PartialDeep<T> = T extends () => unknown
  ? T
  : T extends object
    ? {
        [Key in keyof T]?: T[Key] extends object ? PartialDeep<T[Key]> : T[Key];
      }
    : never;

export interface AuthOptions {
  session: {
    /**
     * The duration an unauthenticated session remains valid before expiring.
     *
     * Accepts a number (seconds) or a duration string consisting of one or more time units.
     * Each time unit is an integer (up to 5 digits) followed by a unit character:
     * - `d` = days
     * - `h` = hours
     * - `m` = minutes
     * - `s` = seconds
     *
     * Examples:
     * - 3600        // 1 hour in seconds
     * - '3h'        // 3 hours
     * - '1h30m'     // 1 hour and 30 minutes
     *
     * @default '3h'
     */
    defaultTimeout: string | number;
    /**
     * The duration an authenticated session remains valid before expiring.
     *
     * Accepts a number (seconds) or a duration string consisting of one or more time units.
     * Each time unit is an integer (up to 5 digits) followed by a unit character:
     * - `d` = days
     * - `h` = hours
     * - `m` = minutes
     * - `s` = seconds
     *
     * Examples:
     * - 86400       // 1 day in seconds
     * - '7d'        // 7 days
     * - '1h30m'     // 1 hour and 30 minutes
     *
     * @default '7d'
     */
    authenticatedTimeout: string | number;
  };
  cookies: {
    session: {
      /**
       * The name of the session cookie.
       *
       * @default 'auth.session'
       */
      name: string;
      /**
       * The options for the session cookie.
       *
       * @default
       * {
       *   path: '/',
       *   httpOnly: true,
       *   secure: process.env.NODE_ENV === 'production',
       *   sameSite: 'lax',
       * }
       */
      options: {
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'lax' | 'strict' | 'none';
      };
    };
    csrf: {
      /**
       * The name of the CSRF cookie.
       *
       * @default 'auth.csrf'
       */
      name: string;
      /**
       * The options for the CSRF cookie.
       *
       * @default
       * {
       *   path: '/',
       *   httpOnly: true,
       *   secure: process.env.NODE_ENV === 'production',
       *   sameSite: 'lax',
       * }
       */
      options: {
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'lax' | 'strict' | 'none';
      };
    };
  };
  /**
   * The namespace used for storing session data in Valkey.
   * This value is prepended to all session keys to avoid collisions with other data.
   *
   * Every {@link Auth} instance is a separate authentication realm and **must** be given its own
   * namespace. Two realms that share a namespace also share a keyspace, so a session id minted by
   * one realm resolves in the other — the realms would then be separated only by cookie name,
   * which the client controls. There is deliberately no default.
   */
  namespace: string;
  /**
   * A function to generate a session ID.
   *
   * @default () => nanoid(32)
   */
  generateId: () => string;
  /**
   * A function to generate a CSRF token.
   *
   * @default () => nanoid(32)
   */
  generateCSRFToken: () => string;
}

export interface AuthResult {
  handle: Handle;
  /**
   * The resolved authenticated session timeout, in seconds. This is the value actually used by
   * `handle` to set the authenticated session cookie `maxAge` and Valkey TTL — not the raw
   * duration string from `AuthOptions`.
   *
   * Exposed so downstream handles (e.g. CloudFront signed cookie issuance) can align their own
   * TTLs with the session's sliding window without needing to re-parse durations or query Valkey.
   */
  authenticatedTimeout: number;
  /**
   * Signs in the provided user by destroying the current session and creating a new one. The new
   * session will be associated with the provided user, replacing `event.locals.session` and
   * updating the session cookies accordingly.
   *
   * @param event - The SvelteKit request event.
   * @param user - The user to associate with the new session.
   */
  signIn: (event: RequestEvent, user: User | AdminUser) => Promise<void>;
  /**
   * Signs out the user by destroying the current session and creating a new one. The new session
   * will be unauthenticated, replacing `event.locals.session` and updating the session cookies
   * accordingly.
   *
   * @param event - The SvelteKit request event.
   */
  signOut: (event: RequestEvent) => Promise<void>;
  /**
   * Validates the CSRF token.
   *
   * @param event - The SvelteKit request event.
   * @param token - The CSRF token to validate.
   * @returns `true` if the CSRF token is valid, `false` otherwise.
   */
  validateCSRFToken: (event: RequestEvent, token: string) => Promise<boolean>;
}

/**
 * The default session timeout for unauthenticated sessions.
 */
const DEFAULT_SESSION_DEFAULT_TIMEOUT = '5m';
/**
 * The default session timeout for authenticated sessions.
 */
const DEFAULT_SESSION_AUTHENTICATED_TIMEOUT = '7d';

/**
 * The default name for the session cookie.
 */
const DEFAULT_COOKIES_SESSION_NAME = 'auth.session';
/**
 * The default options for the session cookie.
 */
const DEFAULT_COOKIES_SESSION_OPTIONS: AuthOptions['cookies']['session']['options'] = {
  path: '/',
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
};

/**
 * The default name for the CSRF cookie.
 */
const DEFAULT_COOKIES_CSRF_NAME = 'auth.csrf';
/**
 * The default options for the CSRF cookie.
 */
const DEFAULT_COOKIES_CSRF_OPTIONS: AuthOptions['cookies']['csrf']['options'] = {
  path: '/',
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
};

/**
 * The default function to generate a session ID.
 */
const DEFAULT_GENERATE_ID: AuthOptions['generateId'] = () => nanoid(32);
/**
 * The default function to generate a CSRF token.
 */
const DEFAULT_GENERATE_CSRF_TOKEN: AuthOptions['generateCSRFToken'] = () => nanoid(32);

/**
 * Initialise the authentication module for SvelteKit.
 *
 * Example:
 * ```ts
 * // src/lib/server/auth.ts
 * import Auth from "@onward/auth";
 * import { valkey } from './valkey.js';
 *
 * export const auth = Auth(valkey, { namespace: 'auth:session:learner' });
 *
 * // src/hooks.server.ts
 * import type { Handle } from '@sveltejs/kit';
 * import { sequence } from '@sveltejs/kit/hooks';
 * import { auth } from '$lib/auth';
 *
 * export const handle: Handle = sequence(auth.handle);
 * ```
 *
 * @param valkey - The Valkey client instance.
 * @param options - The configuration for this realm. `namespace` is required; everything else
 *                  overrides a default.
 * @returns A set of functions that set up authentication middleware and utilities to interact with the session in SvelteKit.
 */
export default function Auth(
  valkey: GlideClient,
  options: PartialDeep<AuthOptions> & Pick<AuthOptions, 'namespace'>,
): AuthResult {
  if (!options.namespace) {
    throw new Error(
      'Missing "namespace" option. Each Auth instance is a separate realm and requires its own namespace.',
    );
  }

  const defaultTimeout = options?.session?.defaultTimeout
    ? typeof options.session.defaultTimeout === 'number'
      ? options.session.defaultTimeout
      : parseDuration(options.session.defaultTimeout)
    : parseDuration(DEFAULT_SESSION_DEFAULT_TIMEOUT);

  if (!defaultTimeout) {
    throw new Error(
      `Invalid "session.defaultTimeout" value: "${options?.session?.defaultTimeout}". Expected a positive number (seconds) or duration string (e.g., "3h", "30m", "1d")`,
    );
  }

  const authenticatedTimeout = options?.session?.authenticatedTimeout
    ? typeof options.session.authenticatedTimeout === 'number'
      ? options.session.authenticatedTimeout
      : parseDuration(options.session.authenticatedTimeout)
    : parseDuration(DEFAULT_SESSION_AUTHENTICATED_TIMEOUT);

  if (!authenticatedTimeout) {
    throw new Error(
      `Invalid "session.authenticatedTimeout" value: "${options?.session?.authenticatedTimeout}". Expected a positive number (seconds) or duration string (e.g., "7d", "24h", "1440m")`,
    );
  }

  const opts = {
    session: {
      defaultTimeout,
      authenticatedTimeout,
    },
    cookies: {
      session: {
        name: options?.cookies?.session?.name ?? DEFAULT_COOKIES_SESSION_NAME,
        options: {
          ...DEFAULT_COOKIES_SESSION_OPTIONS,
          ...options?.cookies?.session?.options,
        },
      },
      csrf: {
        name: options?.cookies?.csrf?.name ?? DEFAULT_COOKIES_CSRF_NAME,
        options: {
          ...DEFAULT_COOKIES_CSRF_OPTIONS,
          ...options?.cookies?.csrf?.options,
        },
      },
    },
    namespace: options.namespace,
    generateId: options?.generateId ?? DEFAULT_GENERATE_ID,
    generateCSRFToken: options?.generateCSRFToken ?? DEFAULT_GENERATE_CSRF_TOKEN,
  } satisfies AuthOptions;

  return {
    authenticatedTimeout: opts.session.authenticatedTimeout,
    handle: async ({ event, resolve }) => {
      const sid = event.cookies.get(opts.cookies.session.name);

      let session: Session | null = null;
      if (sid) {
        session = await Session.prepare(valkey, sid, { namespace: opts.namespace });
      }
      if (!session) {
        session = Session.create(null, {
          generateId: opts.generateId,
          generateCSRFToken: opts.generateCSRFToken,
        });
      }

      event.locals.session = session;

      // Set the session cookie.
      event.cookies.set(opts.cookies.session.name, event.locals.session.id, {
        ...opts.cookies.session.options,
        maxAge: event.locals.session.isAuthenticated
          ? opts.session.authenticatedTimeout
          : opts.session.defaultTimeout,
      });

      // Set the CSRF cookie.
      event.cookies.set(opts.cookies.csrf.name, event.locals.session.csrfToken(), {
        ...opts.cookies.csrf.options,
      });

      const response = await resolve(event);

      await Session.commit(valkey, event.locals.session, {
        namespace: opts.namespace,
        ttl: event.locals.session.isAuthenticated
          ? opts.session.authenticatedTimeout
          : opts.session.defaultTimeout,
      });

      return response;
    },
    signIn: async (event, user) => {
      await Session.destroy(valkey, event.locals.session.id, { namespace: opts.namespace });

      event.locals.session = Session.create(user, {
        generateId: opts.generateId,
        generateCSRFToken: opts.generateCSRFToken,
      });

      // Set the session cookie.
      event.cookies.set(opts.cookies.session.name, event.locals.session.id, {
        ...opts.cookies.session.options,
        maxAge: event.locals.session.isAuthenticated
          ? opts.session.authenticatedTimeout
          : opts.session.defaultTimeout,
      });

      // Set the CSRF cookie.
      event.cookies.set(opts.cookies.csrf.name, event.locals.session.csrfToken(), {
        ...opts.cookies.csrf.options,
      });
    },
    signOut: async (event: RequestEvent) => {
      await Session.destroy(valkey, event.locals.session.id, { namespace: opts.namespace });

      event.locals.session = Session.create(null, {
        generateId: opts.generateId,
        generateCSRFToken: opts.generateCSRFToken,
      });

      // Set the session cookie.
      event.cookies.set(opts.cookies.session.name, event.locals.session.id, {
        ...opts.cookies.session.options,
        maxAge: event.locals.session.isAuthenticated
          ? opts.session.authenticatedTimeout
          : opts.session.defaultTimeout,
      });

      // Set the CSRF cookie.
      event.cookies.set(opts.cookies.csrf.name, event.locals.session.csrfToken(), {
        ...opts.cookies.csrf.options,
      });
    },
    validateCSRFToken: async (event, token) => {
      if (!token) {
        return false;
      }

      let csrfToken = event.cookies.get(opts.cookies.csrf.name);
      if (!csrfToken) {
        return false;
      }

      token = unmask(token);
      csrfToken = unmask(csrfToken);

      if (
        token.length !== csrfToken.length ||
        !timingSafeEqual(Buffer.from(csrfToken), Buffer.from(token))
      ) {
        return false;
      }

      return true;
    },
  };
}
