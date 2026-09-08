import type { GlideClient } from '@valkey/valkey-glide';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import Session from './session.js';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

const store = new Map<string, string>();

const valkey = {
  get: async (key: string) => store.get(key) ?? null,
  set: async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  },
  del: async (keys: string[]) => {
    let deleted = 0;
    for (const key of keys) {
      if (store.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  },
} as unknown as GlideClient;

const NAMESPACE = 'auth:session:test';

function seed(id: string, user: unknown) {
  store.set(`${NAMESPACE}:${id}`, JSON.stringify({ id, csrfToken: 'csrf', user, data: {} }));
}

beforeEach(() => {
  store.clear();
});

describe('Session.prepare', () => {
  test('returns null when no session is stored under the namespaced key', async () => {
    expect(await Session.prepare(valkey, 'missing', { namespace: NAMESPACE })).toBeNull();
  });

  test('reads a stored admin user back with its stored isActive value', async () => {
    seed('sid', { id: 'admin-1', email: 'admin@example.com', name: 'Admin', isActive: true });

    const session = await Session.prepare(valkey, 'sid', { namespace: NAMESPACE });

    expect(session?.user).toMatchObject({ id: 'admin-1', isActive: true });
  });

  test('treats an admin user whose stored isActive is not a boolean as inactive', async () => {
    seed('sid', { id: 'admin-1', email: 'admin@example.com', name: 'Admin', isActive: 'yes' });

    const session = await Session.prepare(valkey, 'sid', { namespace: NAMESPACE });

    expect(session?.user).toMatchObject({ id: 'admin-1', isActive: false });
  });
});
