// @vitest-environment node
// The routes run the real Edupass module. oauth4webapi checks `instanceof Response`,
// `Uint8Array`, and `CryptoKey` against Node's globals, which the jsdom realm would break.
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type RequestEvent } from '@sveltejs/kit';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { HOME_PATH } from '$lib/helpers/index.js';

const { mockSignIn, mockFindUnique, mockCreate, MockKnownRequestError } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockFindUnique: vi.fn(),
  // Typed with the `data` the route passes to `db.user.create`.
  mockCreate: vi.fn<(args: { data: { email: string; name: string } }) => Promise<unknown>>(),
  // Stands in for Prisma's known request error, which the route tells apart by its `code`.
  MockKnownRequestError: class MockKnownRequestError extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

// Mutable env object: the Edupass module reads `$env/dynamic/private` when it loads the settings.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

// `$lib/helpers` re-exports the analytics module, which reads the public env at import time.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

vi.mock('$lib/server/db.js', () => ({
  db: {
    user: {
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  },
  PrismaClientKnownRequestError: MockKnownRequestError,
}));

const ISSUER = 'https://login.microsoftonline.com/test-tenant-0000/v2.0';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/test-tenant-0000/oauth2/v2.0/token';
const JWKS_URI = 'https://login.microsoftonline.com/test-tenant-0000/discovery/v2.0/keys';
const CLIENT_ID = 'test-client-id-1111';

const EDUPASS_ID = '000012345678';

const existingLearner = {
  id: '7',
  email: 'notify@example.com',
  name: 'Edupass Learner',
};

// The key Edupass signs ID tokens with, served from the fake `jwks_uri`.
const idTokenKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

// A throwaway RSA key and self-signed certificate, made with the openssl CLI once per file, then
// loaded into the env the Edupass module reads.
let keysDir: string;

beforeAll(() => {
  keysDir = mkdtempSync(join(tmpdir(), 'edupass-test-'));
  execFileSync(
    'openssl',
    [
      ...'req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=test-only-edupass'.split(' '),
      '-keyout',
      join(keysDir, 'key.pem'),
      '-out',
      join(keysDir, 'cert.pem'),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  env.EDUPASS_OIDC_URL = ISSUER;
  env.EDUPASS_CLIENT_ID = CLIENT_ID;
  env.EDUPASS_CERTIFICATE = readFileSync(join(keysDir, 'cert.pem'), 'utf8');
  env.EDUPASS_PRIVATE_KEY = readFileSync(join(keysDir, 'key.pem'), 'utf8');
});

afterAll(() => {
  rmSync(keysDir, { recursive: true, force: true });
});

let requests: { url: string; method: string; body: URLSearchParams | null }[] = [];
let tokenResponse: () => Response;

// Makes the token endpoint return a valid Edupass ID token, with the `claims` overrides applied and
// signed by `signingKey`. A claim set to `undefined` is left out, because `JSON.stringify` drops it,
// the way Edupass leaves out a claim it has no value for.
function serveIdToken({
  claims = {},
  signingKey = idTokenKeys.privateKey,
}: { claims?: Record<string, unknown>; signingKey?: KeyObject } = {}): void {
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      aud: CLIENT_ID,
      // Differs from `id`, so the lookup test shows which claim keys the learner.
      sub: 'entra-sub-must-not-be-used',
      iat,
      nbf: iat,
      exp: iat + 3600,
      id: EDUPASS_ID,
      name: 'Edupass Learner',
      notificationEmail: 'notify@example.com',
      cesEmail: 'ces@example.com',
      iconEmail: 'icon@example.com',
      wogEmail: 'wog@example.com',
      ...claims,
    }),
  ).toString('base64url');
  tokenResponse = () =>
    new Response(
      JSON.stringify({
        token_type: 'Bearer',
        access_token: 'test-access-token',
        id_token: `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), signingKey).toString('base64url')}`,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

function serveTokenError(error: string): void {
  tokenResponse = () =>
    new Response(JSON.stringify({ error, error_description: 'Trace ID: test-trace-id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
}

// A real logger that writes nothing. Each route logs through a child, which is the one spied on.
const silentLogger = pino({ level: 'silent' });
const routeLogger = silentLogger.child<string>({});
vi.spyOn(silentLogger, 'child').mockReturnValue(routeLogger);
const logWarn = vi.spyOn(routeLogger, 'warn');
const logError = vi.spyOn(routeLogger, 'error');

// The route loaded for the current test, with the env as set in `beforeAll`.
let GET: typeof import('./+server.js').GET;

// A stand-in for the learner session, with its key-value store open to the tests.
function buildSession() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (key: string) => data.get(key) ?? null,
    set: (key: string, value: unknown) => void data.set(key, value),
    del: (key: string) => void data.delete(key),
  };
}

type Session = ReturnType<typeof buildSession>;

// Leaves the session the way `/auth/edupass` does, and returns the state Edupass sends back.
function startSignIn(session: Session, returnTo = '/') {
  const state = Buffer.from(JSON.stringify({ return_to: returnTo })).toString('base64url');
  session.set('edupassCodeVerifier', 'test-code-verifier');
  session.set('edupassState', state);
  return state;
}

// A request with every field SvelteKit gives a route. The route reads only `url` and `locals`.
function callbackEvent(
  session: Session,
  query: Record<string, string>,
): RequestEvent<Record<string, never>, '/(main)/auth/edupass/callback'> {
  const url = new URL(`http://localhost/auth/edupass/callback?${new URLSearchParams(query)}`);
  return {
    cookies: {
      get: () => undefined,
      getAll: () => [],
      set: vi.fn(),
      delete: vi.fn(),
      serialize: () => '',
    },
    fetch,
    getClientAddress: () => '127.0.0.1',
    locals: { logger: silentLogger, session },
    params: {},
    platform: undefined,
    request: new Request(url),
    route: { id: '/(main)/auth/edupass/callback' },
    setHeaders: vi.fn(),
    url,
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: { enabled: false, root: {}, current: {} },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  requests = [];
  serveIdToken();
  // oauth4webapi always calls `fetch(url.href, init)`, with a `URLSearchParams` body on POST.
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({
      url,
      method,
      body: init?.body instanceof URLSearchParams ? init.body : null,
    });

    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return new Response(
        JSON.stringify({
          issuer: ISSUER,
          authorization_endpoint:
            'https://login.microsoftonline.com/test-tenant-0000/oauth2/v2.0/authorize',
          token_endpoint: TOKEN_ENDPOINT,
          jwks_uri: JWKS_URI,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === JWKS_URI) {
      return new Response(
        JSON.stringify({
          keys: [
            {
              ...idTokenKeys.publicKey.export({ format: 'jwk' }),
              use: 'sig',
              alg: 'RS256',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === TOKEN_ENDPOINT && method === 'POST') {
      return tokenResponse();
    }
    return new Response('not found', { status: 404 });
  });
  mockFindUnique.mockResolvedValue(existingLearner);
  mockCreate.mockImplementation(async ({ data }) => ({
    id: '8',
    email: data.email,
    name: data.name,
  }));
  mockSignIn.mockResolvedValue(undefined);

  // Fresh routes and one shared Edupass module per test, with the settings loaded as the root `init`
  // hook loads them at startup. The real auth index connects to Valkey at import, so its mock holds
  // only `learnerAuth`. A `vi.mock` factory result outlives `vi.resetModules()`, so it is registered
  // here.
  vi.resetModules();
  vi.doMock('$lib/server/auth/index.js', () => ({ learnerAuth: { signIn: mockSignIn } }));
  const { loadEdupassSettings } = await import('$lib/server/auth/edupass.js');
  await loadEdupassSettings();
  ({ GET } = await import('./+server.js'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /auth/edupass/callback', () => {
  describe('when the state does not match the session', () => {
    test('redirects to the login page with an error', async () => {
      const session = buildSession();
      startSignIn(session);

      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state: 'forged-state' })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({
        status: 302,
        location: '/login?error=oauth2_callback_failed',
      });
    });

    test('does not redeem the code', async () => {
      const session = buildSession();
      startSignIn(session);

      await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state: 'forged-state' })),
      ).catch(() => undefined);

      expect(requests).not.toContainEqual(
        expect.objectContaining({ url: TOKEN_ENDPOINT, method: 'POST' }),
      );
    });

    test('removes the verifier from the session', async () => {
      const session = buildSession();
      startSignIn(session);

      await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state: 'forged-state' })),
      ).catch(() => undefined);

      expect(session.data.has('edupassCodeVerifier')).toBe(false);
    });

    test('removes the state from the session', async () => {
      const session = buildSession();
      startSignIn(session);

      await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state: 'forged-state' })),
      ).catch(() => undefined);

      expect(session.data.has('edupassState')).toBe(false);
    });
  });

  describe('when no sign-in was started in the session', () => {
    test('redirects to the login page with an error', async () => {
      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(buildSession(), { code: 'auth-code', state: 'any-state' })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({
        status: 302,
        location: '/login?error=oauth2_callback_failed',
      });
    });
  });

  describe('when a learner has the same Edupass ID', () => {
    test('looks the learner up by the Edupass ID', async () => {
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { edupassId: EDUPASS_ID } }),
      );
    });

    test('does not create a learner', async () => {
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('signs that learner in', async () => {
      const session = buildSession();
      const state = startSignIn(session);
      const event = callbackEvent(session, { code: 'auth-code', state });

      await Promise.resolve(GET(event)).catch(() => undefined);

      expect(mockSignIn).toHaveBeenCalledExactlyOnceWith(event, existingLearner);
    });
  });

  describe('when no learner has the Edupass ID', () => {
    test('creates a learner with the Edupass ID, name and chosen email', async () => {
      mockFindUnique.mockResolvedValue(null);
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockCreate.mock.lastCall?.[0].data).toEqual({
        edupassId: EDUPASS_ID,
        name: 'Edupass Learner',
        email: 'ces@example.com',
      });
    });

    test('signs the new learner in', async () => {
      mockFindUnique.mockResolvedValue(null);
      const session = buildSession();
      const state = startSignIn(session);
      const event = callbackEvent(session, { code: 'auth-code', state });

      await Promise.resolve(GET(event)).catch(() => undefined);

      expect(mockSignIn).toHaveBeenCalledExactlyOnceWith(event, {
        id: '8',
        email: 'ces@example.com',
        name: 'Edupass Learner',
      });
    });

    test.each([
      [
        'uses the notification email when there is no CES email',
        { cesEmail: undefined },
        'notify@example.com',
      ],
      [
        'uses the notification email when the CES email is empty',
        { cesEmail: '' },
        'notify@example.com',
      ],
      [
        'uses the ICON email when there is no CES or notification email',
        { cesEmail: undefined, notificationEmail: undefined },
        'icon@example.com',
      ],
      [
        'uses the WOG email when it is the only email',
        { cesEmail: undefined, notificationEmail: undefined, iconEmail: undefined },
        'wog@example.com',
      ],
    ])('%s', async (_label, claims, expected) => {
      mockFindUnique.mockResolvedValue(null);
      serveIdToken({ claims });
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockCreate.mock.lastCall?.[0].data.email).toBe(expected);
    });

    test('lowercases the chosen email', async () => {
      mockFindUnique.mockResolvedValue(null);
      serveIdToken({ claims: { cesEmail: 'John.Tan@Example.COM' } });
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockCreate.mock.lastCall?.[0].data.email).toBe('john.tan@example.com');
    });
  });

  describe('when the ID token has none of the four emails', () => {
    test('redirects to the login page with the no-email error', async () => {
      mockFindUnique.mockResolvedValue(null);
      serveIdToken({
        claims: {
          notificationEmail: undefined,
          cesEmail: undefined,
          iconEmail: undefined,
          wogEmail: undefined,
        },
      });
      const session = buildSession();
      const state = startSignIn(session);

      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({ status: 302, location: '/login?error=edupass_no_email' });
    });
  });

  describe('when the email already belongs to another learner', () => {
    test('redirects to the login page with an error', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_email_key`', 'P2002'),
      );
      const session = buildSession();
      const state = startSignIn(session);

      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({
        status: 302,
        location: '/login?error=oauth2_callback_failed',
      });
    });

    test('logs a warning', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_email_key`', 'P2002'),
      );
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(logWarn).toHaveBeenCalled();
    });
  });

  describe('when another sign-in creates the learner first', () => {
    test('signs that learner in', async () => {
      mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(existingLearner);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_edupass_id_key`', 'P2002'),
      );
      const session = buildSession();
      const state = startSignIn(session);
      const event = callbackEvent(session, { code: 'auth-code', state });

      await Promise.resolve(GET(event)).catch(() => undefined);

      expect(mockSignIn).toHaveBeenCalledExactlyOnceWith(event, existingLearner);
    });
  });

  describe('when creating the learner fails for any other reason', () => {
    test('redirects to the login page with an error', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(new Error('db down'));
      const session = buildSession();
      const state = startSignIn(session);

      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({
        status: 302,
        location: '/login?error=oauth2_callback_failed',
      });
    });

    test('logs an error', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(new Error('db down'));
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(logError).toHaveBeenCalled();
    });
  });

  test.each([
    ['the learner lookup fails', () => mockFindUnique.mockRejectedValue(new Error('db down'))],
    ['starting the session fails', () => mockSignIn.mockRejectedValue(new Error('valkey down'))],
    [
      'the token request fails',
      () => {
        tokenResponse = () => {
          throw new TypeError('network down');
        };
      },
    ],
  ])('redirects to the login page with an error when %s', async (_label, arrange) => {
    arrange();
    const session = buildSession();
    const state = startSignIn(session, '/unit/42');

    const thrown: unknown = await Promise.resolve(
      GET(callbackEvent(session, { code: 'auth-code', state })),
    ).catch((err: unknown) => err);

    expect(thrown).toMatchObject({ status: 302, location: '/login?error=oauth2_callback_failed' });
  });

  test('redirects to the login page with an error when discovery fails', async () => {
    const session = buildSession();
    const state = startSignIn(session);
    // A fresh Edupass module has no settings loaded, so its discovery throws.
    vi.resetModules();
    const { GET: routeWithoutSettings } = await import('./+server.js');

    const thrown: unknown = await Promise.resolve(
      routeWithoutSettings(callbackEvent(session, { code: 'auth-code', state })),
    ).catch((err: unknown) => err);

    expect(thrown).toMatchObject({ status: 302, location: '/login?error=oauth2_callback_failed' });
  });

  describe('Edupass errors from the authorization endpoint', () => {
    test.each(['server_error', 'temporarily_unavailable'])(
      'shows the Edupass-busy error when Edupass sends %s',
      async (error) => {
        const session = buildSession();
        const state = startSignIn(session);

        const thrown: unknown = await Promise.resolve(
          GET(callbackEvent(session, { error, error_description: 'Trace ID: test', state })),
        ).catch((err: unknown) => err);

        expect(thrown).toMatchObject({ status: 302, location: '/login?error=edupass_unavailable' });
      },
    );

    test.each(['access_denied', 'interaction_required', 'invalid_request'])(
      'shows the general sign-in error when Edupass sends %s',
      async (error) => {
        const session = buildSession();
        const state = startSignIn(session);

        const thrown: unknown = await Promise.resolve(
          GET(callbackEvent(session, { error, error_description: 'Trace ID: test', state })),
        ).catch((err: unknown) => err);

        expect(thrown).toMatchObject({
          status: 302,
          location: '/login?error=oauth2_callback_failed',
        });
      },
    );

    test.each(['access_denied', 'server_error', 'temporarily_unavailable'])(
      'logs a warning when Edupass sends %s',
      async (error) => {
        const session = buildSession();
        const state = startSignIn(session);

        await Promise.resolve(
          GET(callbackEvent(session, { error, error_description: 'Trace ID: test', state })),
        ).catch(() => undefined);

        expect(logWarn).toHaveBeenCalled();
      },
    );

    test.each(['interaction_required', 'invalid_request'])(
      'logs an error when Edupass sends %s',
      async (error) => {
        const session = buildSession();
        const state = startSignIn(session);

        await Promise.resolve(
          GET(callbackEvent(session, { error, error_description: 'Trace ID: test', state })),
        ).catch(() => undefined);

        expect(logError).toHaveBeenCalled();
      },
    );
  });

  describe('Edupass errors from the token endpoint', () => {
    test('shows the Edupass-busy error when Edupass sends temporarily_unavailable', async () => {
      serveTokenError('temporarily_unavailable');
      const session = buildSession();
      const state = startSignIn(session);

      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({ status: 302, location: '/login?error=edupass_unavailable' });
    });

    test.each(['invalid_grant', 'interaction_required', 'invalid_client'])(
      'shows the general sign-in error when Edupass sends %s',
      async (error) => {
        serveTokenError(error);
        const session = buildSession();
        const state = startSignIn(session);

        const thrown: unknown = await Promise.resolve(
          GET(callbackEvent(session, { code: 'auth-code', state })),
        ).catch((err: unknown) => err);

        expect(thrown).toMatchObject({
          status: 302,
          location: '/login?error=oauth2_callback_failed',
        });
      },
    );

    test.each(['invalid_grant', 'interaction_required', 'temporarily_unavailable'])(
      'logs a warning when Edupass sends %s',
      async (error) => {
        serveTokenError(error);
        const session = buildSession();
        const state = startSignIn(session);

        await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
          () => undefined,
        );

        expect(logWarn).toHaveBeenCalled();
      },
    );

    test('logs an error when Edupass sends invalid_client', async () => {
      serveTokenError('invalid_client');
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(logError).toHaveBeenCalled();
    });
  });

  describe('redirect after sign-in', () => {
    test('redirects to a site-relative return_to', async () => {
      const session = buildSession();
      const state = startSignIn(session, '/unit/42');

      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({ status: 302, location: '/unit/42' });
    });

    test('redirects to the home page instead of an external return_to', async () => {
      const session = buildSession();
      const state = startSignIn(session, 'https://attacker.example/glow-login');

      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({ status: 302, location: HOME_PATH });
    });
  });

  describe('code exchange and ID token checks', () => {
    test('sends the code and the PKCE verifier to Edupass', async () => {
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(
        Object.fromEntries(
          requests.find((request) => request.url === TOKEN_ENDPOINT && request.method === 'POST')
            ?.body ?? [],
        ),
      ).toMatchObject({
        code: 'auth-code',
        code_verifier: 'test-code-verifier',
        redirect_uri: 'http://localhost/auth/edupass/callback',
      });
    });

    test('accepts an ID token issued up to 30 seconds in the future', async () => {
      serveIdToken({
        claims: {
          iat: Math.floor(Date.now() / 1000) + 10,
          nbf: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3610,
        },
      });
      const session = buildSession();
      const state = startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockSignIn).toHaveBeenCalledOnce();
    });

    test.each([
      ['has no id claim', { claims: { id: undefined } }],
      ['has no name claim', { claims: { name: undefined } }],
      [
        'is signed by a key Edupass does not publish',
        { signingKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey },
      ],
      [
        'was issued more than 30 seconds in the future',
        {
          claims: {
            iat: Math.floor(Date.now() / 1000) + 120,
            nbf: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3720,
          },
        },
      ],
    ])('redirects to the login page with an error when the ID token %s', async (_label, token) => {
      serveIdToken(token);
      const session = buildSession();
      const state = startSignIn(session);

      const thrown: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(thrown).toMatchObject({
        status: 302,
        location: '/login?error=oauth2_callback_failed',
      });
    });
  });
});
