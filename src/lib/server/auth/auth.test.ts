import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { GlideClient } from '@valkey/valkey-glide';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import Auth from './auth.js';

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

function buildEvent() {
  const jar = new Map<string, string>();

  return {
    jar,
    cookies: {
      get: (name: string) => jar.get(name),
      set: (name: string, value: string) => {
        jar.set(name, value);
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    },
    locals: {},
  } as unknown as RequestEvent & { jar: Map<string, string> };
}

beforeEach(() => {
  store.clear();
});

describe('Auth namespace', () => {
  test('rejects an empty namespace instead of falling back to a shared default', () => {
    expect(() => Auth(valkey, { namespace: '' })).toThrow(/namespace/i);
  });

  test('stores the session under the configured namespace', async () => {
    const auth = Auth(valkey, { namespace: 'auth:session:test' });
    const event = buildEvent();

    await auth.handle({
      event,
      resolve: async () => new Response('ok'),
    } as unknown as Parameters<Handle>[0]);

    const sid = event.locals.session.id;
    expect([...store.keys()]).toEqual([`auth:session:test:${sid}`]);
  });
});
