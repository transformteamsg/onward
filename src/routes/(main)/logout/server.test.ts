import { beforeEach, describe, expect, test, vi } from 'vitest';

import * as handlers from './+server.js';
import { POST } from './+server.js';

const { mockSignOut, mockValidateCSRFToken } = vi.hoisted(() => ({
  mockSignOut: vi.fn(),
  mockValidateCSRFToken: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/auth/index.js', () => ({
  learnerAuth: {
    signOut: mockSignOut,
    validateCSRFToken: mockValidateCSRFToken,
  },
}));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};
silentLogger.child.mockReturnValue(silentLogger);

interface BuildEventOptions {
  user?: { id: string; email: string } | null;
  csrfToken?: string | null;
  formDataFails?: boolean;
}

const buildEvent = ({
  user = { id: 'user-1', email: 'learner@example.com' },
  csrfToken = 'csrf-token',
  formDataFails = false,
}: BuildEventOptions = {}) => {
  const data = new FormData();
  if (csrfToken !== null) {
    data.set('csrfToken', csrfToken);
  }

  return {
    locals: { logger: silentLogger, session: { user } },
    cookies: { delete: vi.fn() },
    request: {
      formData: async () => {
        if (formDataFails) {
          throw new TypeError('Could not parse content as FormData');
        }
        return data;
      },
    },
  } as unknown as Parameters<typeof POST>[0];
};

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  mockValidateCSRFToken.mockResolvedValue(true);
  mockSignOut.mockResolvedValue(undefined);
});

describe('POST /logout', () => {
  // The route exported sign-out as a GET handler. The session cookie is `sameSite: 'lax'`, so a
  // cross-site top-level navigation carried it and ended the session.
  test('exposes no GET handler', () => {
    expect('GET' in handlers).toBe(false);
  });

  test('redirects to /login when unauthenticated', async () => {
    const result = POST(buildEvent({ user: null }));

    await expect(result).rejects.toMatchObject({ status: 303, location: '/login' });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test('returns 400 when the CSRF token is missing', async () => {
    const result = POST(buildEvent({ csrfToken: null }));

    await expect(result).rejects.toMatchObject({ status: 400 });
    expect(mockValidateCSRFToken).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test('returns 400 when the request body is not form data', async () => {
    const result = POST(buildEvent({ formDataFails: true }));

    await expect(result).rejects.toMatchObject({ status: 400 });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test('returns 403 and keeps the session when the CSRF token is invalid', async () => {
    mockValidateCSRFToken.mockResolvedValue(false);

    const result = POST(buildEvent());

    await expect(result).rejects.toMatchObject({ status: 403 });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  test('signs the user out and clears the CloudFront cookies on a valid token', async () => {
    const event = buildEvent();

    const result = POST(event);

    await expect(result).rejects.toMatchObject({ status: 303, location: '/login' });
    expect(mockValidateCSRFToken).toHaveBeenCalledWith(event, 'csrf-token');
    expect(mockSignOut).toHaveBeenCalledOnce();
    for (const name of ['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id']) {
      expect(event.cookies.delete).toHaveBeenCalledWith(name, { path: '/' });
    }
  });

  test('redirects with an error when sign-out fails', async () => {
    mockSignOut.mockRejectedValue(new Error('valkey unavailable'));

    const event = buildEvent();
    const result = POST(event);

    await expect(result).rejects.toMatchObject({
      status: 303,
      location: '/login?error=logout_failed',
    });
    expect(event.cookies.delete).not.toHaveBeenCalled();
  });
});
