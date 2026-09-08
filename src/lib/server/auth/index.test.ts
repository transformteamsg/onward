import type { Handle, RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { AdminUser, User } from './session.js';

// A minimal in-memory stand-in for Valkey. `../valkey.js` connects at import
// time, so it has to be replaced before `./index.js` is imported.
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('../valkey.js', () => ({
  valkey: {
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
  },
}));

interface FakeEvent extends RequestEvent {
  jar: Map<string, string>;
}

function buildEvent(cookies: Record<string, string> = {}): FakeEvent {
  const jar = new Map(Object.entries(cookies));

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
  } as unknown as FakeEvent;
}

/**
 * Drives a full request through `handle`, signing `user` in mid-request the way the Google
 * callback does, and returns the session id the realm handed back in its session cookie.
 */
async function signInThroughRealm(
  realm: { handle: Handle; signIn: (event: RequestEvent, user: User | AdminUser) => Promise<void> },
  cookieName: string,
  user: User | AdminUser,
): Promise<string> {
  const event = buildEvent();

  await realm.handle({
    event,
    resolve: async () => {
      await realm.signIn(event, user);
      return new Response('ok');
    },
  } as unknown as Parameters<Handle>[0]);

  const sid = event.jar.get(cookieName);
  if (!sid) {
    throw new Error(`expected the realm to set a "${cookieName}" cookie`);
  }

  return sid;
}

/** Presents `sid` to `realm` in its own session cookie and returns the resolved session. */
async function resolveSession(realm: { handle: Handle }, cookieName: string, sid: string) {
  const event = buildEvent({ [cookieName]: sid });

  await realm.handle({
    event,
    resolve: async () => new Response('ok'),
  } as unknown as Parameters<Handle>[0]);

  return event.locals.session;
}

const learner: User = { id: 'learner-1', email: 'learner@example.com', name: 'Learner' };
const admin: AdminUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  isActive: true,
};

beforeEach(() => {
  store.clear();
});

describe('auth realm isolation', () => {
  test('a learner session id presented as an admin session is not authenticated', async () => {
    const { learnerAuth, adminAuth } = await import('./index.js');
    const sid = await signInThroughRealm(learnerAuth, 'learner.session', learner);

    const session = await resolveSession(adminAuth, 'admin.session', sid);

    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  test('an admin session id presented as a learner session is not authenticated', async () => {
    const { learnerAuth, adminAuth } = await import('./index.js');
    const sid = await signInThroughRealm(adminAuth, 'admin.session', admin);

    const session = await resolveSession(learnerAuth, 'learner.session', sid);

    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  test('a learner session id still resolves in the learner realm', async () => {
    const { learnerAuth } = await import('./index.js');
    const sid = await signInThroughRealm(learnerAuth, 'learner.session', learner);

    const session = await resolveSession(learnerAuth, 'learner.session', sid);

    expect(session.isAuthenticated).toBe(true);
    expect(session.user).toMatchObject({ id: 'learner-1' });
  });

  test('an admin session id still resolves in the admin realm', async () => {
    const { adminAuth } = await import('./index.js');
    const sid = await signInThroughRealm(adminAuth, 'admin.session', admin);

    const session = await resolveSession(adminAuth, 'admin.session', sid);

    expect(session.isAuthenticated).toBe(true);
    expect(session.user).toMatchObject({ id: 'admin-1', isActive: true });
  });
});
