import { beforeEach, describe, expect, test, vi } from 'vitest';

import { HOME_PATH } from '$lib/helpers/index.js';

import { GET } from './+server.js';

const { mockExchangeCodeForIdToken, mockVerifyIdToken, mockSignIn, mockFindUnique } = vi.hoisted(
  () => ({
    mockExchangeCodeForIdToken: vi.fn(),
    mockVerifyIdToken: vi.fn(),
    mockSignIn: vi.fn(),
    mockFindUnique: vi.fn(),
  }),
);

// `$lib/helpers` re-exports the analytics module, which reads the public env at import
// time. The callback imports that barrel for HOME_PATH, so the env has to stand in here.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

vi.mock('$lib/server/auth/index.js', () => ({
  exchangeCodeForIdToken: mockExchangeCodeForIdToken,
  verifyIdToken: mockVerifyIdToken,
  learnerAuth: { signIn: mockSignIn },
  HostedDomainMismatchError: class HostedDomainMismatchError extends Error {},
}));

vi.mock('$lib/server/db.js', () => ({
  db: { user: { findUnique: mockFindUnique } },
  PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
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

// The callback only reaches the redirect when the state it receives matches the state
// held in the session, so every case here builds both from one `return_to`.
function buildEvent(returnTo: unknown) {
  const state = Buffer.from(JSON.stringify({ csrf_token: 'csrf', return_to: returnTo })).toString(
    'base64url',
  );
  const authURL = `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`;
  const session = {
    get: (key: string) => (key === 'codeVerifier' ? CODE_VERIFIER : authURL),
  };

  return {
    url: new URL(`http://localhost/auth/google/callback?code=auth-code&state=${state}`),
    locals: { logger: silentLogger, session },
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  mockExchangeCodeForIdToken.mockResolvedValue('id-token');
  mockVerifyIdToken.mockResolvedValue({
    id: 'google-1',
    email: 'learner@example.com',
    name: 'Learner',
    picture: 'https://example.com/avatar.png',
  });
  mockFindUnique.mockResolvedValue({
    id: 1,
    email: 'learner@example.com',
    name: 'Learner',
    avatarURL: null,
  });
  mockSignIn.mockResolvedValue(undefined);
});

describe('GET /auth/google/callback', () => {
  test('redirects to a site-relative return_to', async () => {
    await expect(GET(buildEvent('/unit/42'))).rejects.toMatchObject({
      status: 302,
      location: '/unit/42',
    });
  });

  test('redirects to the home page when no return_to was sent', async () => {
    await expect(GET(buildEvent(undefined))).rejects.toMatchObject({
      status: 302,
      location: HOME_PATH,
    });
  });

  test('does not send a signed-in learner to an external site', async () => {
    await expect(GET(buildEvent('https://attacker.example/onward-login'))).rejects.toMatchObject({
      status: 302,
      location: HOME_PATH,
    });
  });

  test('does not follow a protocol-relative return_to off this origin', async () => {
    await expect(GET(buildEvent('//attacker.example/onward-login'))).rejects.toMatchObject({
      status: 302,
      location: HOME_PATH,
    });
  });

  test('does not follow a backslash authority off this origin', async () => {
    await expect(GET(buildEvent('/\\attacker.example'))).rejects.toMatchObject({
      status: 302,
      location: HOME_PATH,
    });
  });

  test('does not follow a dot segment that collapses into a protocol-relative path', async () => {
    await expect(GET(buildEvent('/.//attacker.example'))).rejects.toMatchObject({
      status: 302,
      location: HOME_PATH,
    });
  });

  test('still signs the learner in when it rejects the return_to', async () => {
    await expect(GET(buildEvent('https://attacker.example'))).rejects.toMatchObject({
      status: 302,
    });
    expect(mockSignIn).toHaveBeenCalledOnce();
  });
});
