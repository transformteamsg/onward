import { type GlideClient, TimeUnit } from '@valkey/valkey-glide';
import { nanoid } from 'nanoid';

import { mask } from './helpers/index.js';

/**
 * The default length of the session ID.
 */
const DEFAULT_SESSION_ID_LENGTH = 32;
/**
 * The default length of the CSRF token.
 */
const DEFAULT_CSRF_TOKEN_LENGTH = 32;

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | JSONValue[] | JSONObject;
type JSONObject = { [key in string]: JSONValue };

/**
 * A class representing a session.
 */
export default class Session {
  #id: string;
  #csrfToken: string;
  #user: User | AdminUser | null;
  #data: JSONObject;

  private constructor({
    id,
    csrfToken,
    user,
    data,
  }: {
    id: string;
    csrfToken: string;
    user: User | AdminUser | null;
    data: JSONObject;
  }) {
    this.#id = id;
    this.#csrfToken = csrfToken;
    this.#user = user;
    this.#data = data;
  }

  /**
   * Creates a {@link Session} with an optional user. If a valid user is provided, the session is
   * considered authenticated. Otherwise, the session is considered unauthenticated.
   *
   * @param user - The user to associate with the session.
   * @param options.generateId - An optional function to override the default session ID generation.
   * @param options.generateCSRFToken - An optional function to override the default CSRF token generation.
   * @returns A {@link Session} with the user associated with it.
   */
  static create(
    user: User | AdminUser | null,
    options: {
      generateId?: () => string;
      generateCSRFToken?: () => string;
    } = {},
  ) {
    return new Session({
      id: options.generateId?.() ?? nanoid(DEFAULT_SESSION_ID_LENGTH),
      csrfToken: options.generateCSRFToken?.() ?? nanoid(DEFAULT_CSRF_TOKEN_LENGTH),
      user,
      data: {},
    });
  }

  /**
   * Prepares a {@link Session} by retrieving it from Valkey using the provided key. Returns `null` if
   * the session does not exist or the session data is invalid.
   *
   * @param valkey - The Valkey client.
   * @param key - A unique key used to retrieve the session from Valkey.
   * @param options.namespace - An optional namespace to prefix the key with.
   * @returns A {@link Session} with the data retrieved from Valkey, or `null` if the session does not exist or the session data is invalid.
   */
  static async prepare(
    valkey: GlideClient,
    key: string,
    options: { namespace?: string } = {},
  ): Promise<Session | null> {
    if (!key) {
      return null;
    }

    key = options.namespace ? `${options.namespace}:${key}` : key;
    const value = await valkey.get(key);
    if (!value) {
      return null;
    }

    let payload: JSONObject;
    try {
      payload = JSON.parse(value.toString());
    } catch {
      return null;
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      !('id' in payload) ||
      typeof payload['id'] !== 'string' ||
      !('csrfToken' in payload) ||
      typeof payload['csrfToken'] !== 'string' ||
      !('user' in payload) ||
      typeof payload['user'] !== 'object' ||
      Array.isArray(payload['user']) ||
      !('data' in payload) ||
      !payload['data'] ||
      typeof payload['data'] !== 'object' ||
      Array.isArray(payload['data'])
    ) {
      return null;
    }

    if (payload['user'] === null) {
      return new Session({
        id: payload['id'],
        csrfToken: payload['csrfToken'],
        user: null,
        data: payload['data'],
      });
    }

    if (
      !payload['user']['id'] ||
      typeof payload['user']['id'] !== 'string' ||
      !payload['user']['email'] ||
      typeof payload['user']['email'] !== 'string' ||
      !payload['user']['name'] ||
      typeof payload['user']['name'] !== 'string'
    ) {
      return null;
    }

    // The presence of `isActive` marks a payload written from an {@link AdminUser}. Nothing
    // authorises off this flag: each realm has its own Valkey namespace, and the admin route
    // guard re-resolves the session against the `UserAdmin` table on every request. The flag
    // only decides which shape to hand back.
    const isAdmin = 'isActive' in payload['user'];

    return new Session({
      id: payload['id'],
      csrfToken: payload['csrfToken'],
      user: isAdmin
        ? {
            id: payload['user']['id'],
            email: payload['user']['email'],
            name: payload['user']['name'],
            // A stored value that is not a boolean means the payload is corrupt, so fail closed.
            isActive:
              typeof payload['user']['isActive'] === 'boolean'
                ? payload['user']['isActive']
                : false,
          }
        : {
            id: payload['user']['id'],
            email: payload['user']['email'],
            name: payload['user']['name'],
          },
      data: payload['data'],
    });
  }

  /**
   * Commits the given {@link Session} to Valkey using the session's ID as the key.
   *
   * @param valkey - The Valkey client.
   * @param session - The {@link Session} to commit.
   * @param options.namespace - An optional namespace to prefix the key with.
   * @param options.ttl - An optional time-to-live (TTL) for the session in seconds. If not provided, the session will **NOT** expire.
   */
  static async commit(
    valkey: GlideClient,
    session: Session,
    options: { namespace?: string; ttl?: number } = {},
  ): Promise<void> {
    const key = options.namespace ? `${options.namespace}:${session.#id}` : session.#id;
    const value = JSON.stringify({
      id: session.#id,
      csrfToken: session.#csrfToken,
      user: session.#user,
      data: session.#data,
    });

    await valkey.set(
      key,
      value,
      options.ttl ? { expiry: { type: TimeUnit.Seconds, count: options.ttl } } : undefined,
    );
  }

  /**
   * Destroys the {@link Session} from Valkey using the provided key.
   *
   * @param valkey - The Valkey client.
   * @param key - A unique key used to destroy the {@link Session} data from Valkey.
   * @param options.namespace - An optional namespace to prefix the key with.
   */
  static async destroy(
    valkey: GlideClient,
    key: string,
    options: { namespace?: string } = {},
  ): Promise<void> {
    if (!key) {
      return;
    }

    key = options.namespace ? `${options.namespace}:${key}` : key;
    await valkey.del([key]);
  }

  /**
   * Returns the unique identifier for the session.
   */
  get id(): string {
    return this.#id;
  }

  /**
   * Returns `true` if the session is authenticated. Otherwise, returns `false`.
   */
  get isAuthenticated(): boolean {
    return !!this.#user;
  }

  /**
   * Returns a masked version of the CSRF token.
   */
  csrfToken(): string {
    return mask(this.#csrfToken);
  }

  /**
   * Returns the user associated with the session, or `null` if the session is unauthenticated.
   */
  get user(): User | AdminUser | null {
    return this.#user ? { ...this.#user } : null;
  }

  /**
   * Stores a value in the session's key-value store.
   *
   * @param key - The key to set.
   * @param value - The value to set.
   */
  set(key: string, value: JSONValue) {
    this.#data[key] = value;
  }

  /**
   * Deletes a value from the session's key-value store.
   *
   * @param key - The key to delete.
   */
  del(key: string) {
    delete this.#data[key];
  }

  /**
   * Returns the value associated with the given key from the session's key-value store. If the key
   * does not exist and no default value is provided, `null` is returned.
   *
   * @param key - The key to get.
   * @param defaultValue - An optional default value to return if the key does not exist.
   * @returns Either the value associated with the key, the default value if one is provided, or `null` if no default value is provided.
   */
  get<T extends JSONValue>(key: string, defaultValue?: T): T | null {
    const value = this.#data[key];
    if (!value) {
      return defaultValue ?? null;
    }

    return value as T;
  }
}
