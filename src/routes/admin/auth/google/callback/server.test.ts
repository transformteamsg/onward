import { beforeEach, describe, expect, test, vi } from 'vitest';

import { GET } from './+server.js';

const { mockExchangeCodeForIdToken, mockVerifyIdToken, mockSignIn, mockFindUniqueOrThrow } =
  vi.hoisted(() => ({
    mockExchangeCodeForIdToken: vi.fn(),
    mockVerifyIdToken: vi.fn(),
    mockSignIn: vi.fn(),
    mockFindUniqueOrThrow: vi.fn(),
  }));

vi.mock('$lib/server/auth/index.js', () => ({
  exchangeCodeForIdToken: mockExchangeCodeForIdToken,
  verifyIdToken: mockVerifyIdToken,
  adminAuth: { signIn: mockSignIn },
}));

vi.mock('$lib/server/db.js', () => ({
  db: { userAdmin: { findUniqueOrThrow: mockFindUniqueOrThrow } },
}));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};
silentLogger.child.mockReturnValue(silentLogger);

const CODE_VERIFIER = 'code-verifier';
const ADMIN_PATH = '/admin';

// The callback only reaches the redirect when the state it receives matches the state
// held in the session, so every case here builds both from one `return_to`.
function buildEvent(returnTo: unknown) {
  const state = Buffer.from(JSON.stringify({ csrf_token: 'csrf', return_to: returnTo })).toString(
    'base64url',
  );
  const authURL = `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`;
  const session = {
    get: (key: string) => (key === 'adminCodeVerifier' ? CODE_VERIFIER : authURL),
  };

  return {
    url: new URL(`http://localhost/admin/auth/google/callback?code=auth-code&state=${state}`),
    locals: { logger: silentLogger, session },
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  mockExchangeCodeForIdToken.mockResolvedValue('id-token');
  mockVerifyIdToken.mockResolvedValue({
    id: 'google-1',
    email: 'admin@example.com',
    name: 'Admin',
    picture: 'https://example.com/avatar.png',
  });
  mockFindUniqueOrThrow.mockResolvedValue({
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    googleProviderId: 'google-1',
    isActive: true,
  });
  mockSignIn.mockResolvedValue(undefined);
});

describe('GET /admin/auth/google/callback', () => {
  test('redirects to a site-relative return_to', async () => {
    await expect(GET(buildEvent('/admin/unit/new'))).rejects.toMatchObject({
      status: 302,
      location: '/admin/unit/new',
    });
  });

  test('redirects to the admin home when no return_to was sent', async () => {
    await expect(GET(buildEvent(null))).rejects.toMatchObject({
      status: 302,
      location: ADMIN_PATH,
    });
  });

  test('does not send a signed-in admin to an external site', async () => {
    await expect(GET(buildEvent('https://attacker.example/onward-login'))).rejects.toMatchObject({
      status: 302,
      location: ADMIN_PATH,
    });
  });

  test('does not follow a protocol-relative return_to off this origin', async () => {
    await expect(GET(buildEvent('//attacker.example/onward-login'))).rejects.toMatchObject({
      status: 302,
      location: ADMIN_PATH,
    });
  });

  test('does not follow a backslash authority off this origin', async () => {
    await expect(GET(buildEvent('/\\attacker.example'))).rejects.toMatchObject({
      status: 302,
      location: ADMIN_PATH,
    });
  });

  test('still signs the admin in when it rejects the return_to', async () => {
    await expect(GET(buildEvent('https://attacker.example'))).rejects.toMatchObject({
      status: 302,
    });
    expect(mockSignIn).toHaveBeenCalledOnce();
  });
});
