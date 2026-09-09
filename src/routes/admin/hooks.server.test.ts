import type { Handle, RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { AdminUser, User } from '$lib/server/auth/session.js';

const { mockFindUnique, mockSignOut, silentLogger } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);

  return { mockFindUnique: vi.fn(), mockSignOut: vi.fn(), silentLogger: logger };
});

// SvelteKit's own `sequence` reads its request store from async-local storage, which only
// exists inside a real request. This stand-in composes the handles left to right, so the
// order and the resolve chain under test are the production ones.
vi.mock('@sveltejs/kit/hooks', () => ({
  sequence:
    (...handles: Handle[]): Handle =>
    ({ event, resolve }) => {
      const step = (index: number, current: RequestEvent): Response | Promise<Response> => {
        const handle = handles[index];
        if (!handle) {
          return resolve(current);
        }

        return handle({ event: current, resolve: (next) => step(index + 1, next) });
      };

      return step(0, event);
    },
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$lib/server/db.js', () => ({
  db: { userAdmin: { findUnique: mockFindUnique } },
}));
vi.mock('$lib/server/logger.js', () => ({ logger: silentLogger }));
// `adminAuth.handle` is the realm's own session-loading handle; it is exercised in
// src/lib/server/auth/index.test.ts. Here it passes through so each test can plant the
// session that the route-protection handle must judge.
vi.mock('$lib/server/auth/index.js', () => ({
  adminAuth: {
    handle: (async ({ event, resolve }) => resolve(event)) satisfies Handle,
    signOut: mockSignOut,
  },
}));

const activeAdmin: AdminUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  isActive: true,
};
const learner: User = { id: 'learner-1', email: 'learner@example.com', name: 'Learner' };

function buildEvent(pathname: string, user: User | AdminUser | null) {
  return {
    url: new URL(`http://localhost${pathname}`),
    setHeaders: vi.fn(),
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    locals: {
      session: {
        id: 'session-id',
        isAuthenticated: !!user,
        user,
        csrfToken: () => 'csrf',
      },
    },
  } as unknown as Parameters<Handle>[0]['event'];
}

async function run(pathname: string, user: User | AdminUser | null) {
  const { handle } = await import('./hooks.server.js');
  const resolve = vi.fn(async () => new Response('ok'));
  const event = buildEvent(pathname, user);

  return { event, resolve, result: handle({ event, resolve } as Parameters<Handle>[0]) };
}

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
});

describe('admin route protection', () => {
  test('redirects an unauthenticated request to the admin login page', async () => {
    const { result } = await run('/admin', null);

    await expect(result).rejects.toMatchObject({ status: 303, location: '/admin/login' });
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('denies a session whose user is not a UserAdmin', async () => {
    mockFindUnique.mockResolvedValue(null);

    const { resolve, result } = await run('/admin', learner);

    await expect(result).rejects.toMatchObject({
      status: 303,
      location: '/admin/login?error=unauthorized',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  test('looks the admin up by the id stored on the session', async () => {
    mockFindUnique.mockResolvedValue({ ...activeAdmin });

    const { result } = await run('/admin', activeAdmin);
    await result;

    expect(mockFindUnique.mock.calls[0][0]).toMatchObject({ where: { id: 'admin-1' } });
  });

  test('denies a session whose UserAdmin is inactive', async () => {
    mockFindUnique.mockResolvedValue({ ...activeAdmin, isActive: false });

    const { resolve, result } = await run('/admin', { ...activeAdmin, isActive: true });

    await expect(result).rejects.toMatchObject({
      status: 303,
      location: '/admin/login?error=inactive',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  test('denies an admin whose record cannot be read', async () => {
    mockFindUnique.mockRejectedValue(new Error('connection lost'));

    const { resolve, result } = await run('/admin', activeAdmin);

    await expect(result).rejects.toMatchObject({
      status: 303,
      location: '/admin/login?error=server_error',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  test('lets an active UserAdmin through', async () => {
    mockFindUnique.mockResolvedValue({ ...activeAdmin });

    const { resolve, result } = await run('/admin', activeAdmin);

    await expect(result).resolves.toBeInstanceOf(Response);
    expect(resolve).toHaveBeenCalledOnce();
  });

  test.each(['/admin/login', '/admin/auth/google', '/admin/auth/google/callback'])(
    'lets %s through without an admin lookup',
    async (pathname) => {
      const { resolve, result } = await run(pathname, null);

      await expect(result).resolves.toBeInstanceOf(Response);
      expect(resolve).toHaveBeenCalledOnce();
      expect(mockFindUnique).not.toHaveBeenCalled();
    },
  );
});
