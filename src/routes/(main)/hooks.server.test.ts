import type { Handle, RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { User } from '$lib/server/auth/session.js';

const { mockSignedCookies, silentLogger } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);

  return { mockSignedCookies: vi.fn(), silentLogger: logger };
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
vi.mock('$lib/server/logger.js', () => ({ logger: silentLogger }));
vi.mock('$lib/server/cloudfront.js', () => ({ getCloudFrontSignedCookies: mockSignedCookies }));
// `learnerAuth.handle` is the realm's own session-loading handle; it is exercised in
// src/lib/server/auth/index.test.ts. Here it passes through so each test can plant the
// session that the route-protection handle must judge.
vi.mock('$lib/server/auth/index.js', () => ({
  learnerAuth: {
    handle: (async ({ event, resolve }) => resolve(event)) satisfies Handle,
    authenticatedTimeout: 3600,
  },
}));

const learner: User = { id: 'learner-1', email: 'learner@example.com', name: 'Learner' };

function buildEvent(pathname: string, user: User | null) {
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

async function run(pathname: string, user: User | null = null) {
  const { handle } = await import('./hooks.server.js');
  const resolve = vi.fn(async () => new Response('ok'));
  const event = buildEvent(pathname, user);

  return { event, resolve, result: handle({ event, resolve } as Parameters<Handle>[0]) };
}

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  mockSignedCookies.mockReturnValue(null);
});

// `%6C` is `l` and `%61` is `a`, so each encoded pathname here decodes to the route named
// beside it. SvelteKit matches routes on the decoded path, so these comparisons must read
// the same decoded value the router matched, not the raw `event.url.pathname`.
describe('learner route protection compares the decoded pathname', () => {
  test('exempts an encoded /login from the sign-in redirect', async () => {
    const { resolve, result } = await run('/%6Cogin');

    await expect(result).resolves.toBeInstanceOf(Response);
    expect(resolve).toHaveBeenCalledOnce();
  });

  test('lets an encoded /api/ path through without a session', async () => {
    const { resolve, result } = await run('/%61pi/onboarding');

    await expect(result).resolves.toBeInstanceOf(Response);
    expect(resolve).toHaveBeenCalledOnce();
  });

  test('redirects an authenticated request for an encoded /login to the home page', async () => {
    const { HOME_PATH } = await import('$lib/helpers/index.js');
    const { resolve, result } = await run('/%6Cogin', learner);

    await expect(result).rejects.toMatchObject({ status: 302, location: HOME_PATH });
    expect(resolve).not.toHaveBeenCalled();
  });

  test('sends the decoded path in return_to, so it is not encoded a second time', async () => {
    const { resolve, result } = await run('/%61bc');

    await expect(result).rejects.toMatchObject({
      status: 303,
      location: '/login?return_to=%2Fabc',
    });
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('learner route protection', () => {
  test('redirects an unauthenticated request for a protected route', async () => {
    const { resolve, result } = await run('/dashboard');

    await expect(result).rejects.toMatchObject({
      status: 303,
      location: '/login?return_to=%2Fdashboard',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  test.each(['/login', '/auth/google', '/auth/google/callback', '/terms', '/privacy'])(
    'lets %s through without a session',
    async (pathname) => {
      const { resolve, result } = await run(pathname);

      await expect(result).resolves.toBeInstanceOf(Response);
      expect(resolve).toHaveBeenCalledOnce();
    },
  );

  test('lets an /api/ path through without a session', async () => {
    const { resolve, result } = await run('/api/onboarding');

    await expect(result).resolves.toBeInstanceOf(Response);
    expect(resolve).toHaveBeenCalledOnce();
  });

  test('lets an authenticated request through a protected route', async () => {
    const { resolve, result } = await run('/dashboard', learner);

    await expect(result).resolves.toBeInstanceOf(Response);
    expect(resolve).toHaveBeenCalledOnce();
  });
});
