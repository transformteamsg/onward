// @vitest-environment node
// The routes run the real Edupass module. oauth4webapi checks `instanceof Response`,
// `Uint8Array`, and `CryptoKey` against Node's globals, which the jsdom realm would break.
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import pino from 'pino';
import {
  afterAll,
  afterEach,
  assert,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { HOME_PATH } from '$lib/helpers/index.js';
import { mask } from '$lib/server/auth/helpers/mask.js';

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

const TENANT = 'test-tenant-0000';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const JWKS_URI = `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`;
const CLIENT_ID = 'test-client-id-1111';

const CALLBACK_FAILED = '/login?error=oauth2_callback_failed';
const UNAVAILABLE = '/login?error=edupass_unavailable';

const EDUPASS_ID = '000012345678';
// The ID token's `sub` differs from the Edupass `id`. The route must never key a learner on it.
const ENTRA_SUB = 'entra-sub-must-not-be-used';

const existingLearner = {
  id: '7',
  email: 'notify@example.com',
  name: 'Edupass Learner',
};

// The key Edupass signs ID tokens with, served from the fake `jwks_uri`.
const ID_TOKEN_KID = 'test-id-token-key';
const idTokenKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

// Edupass error responses, with the login page error and the log level the route gives each.
const AUTHORIZATION_ERRORS = [
  { error: 'access_denied', location: CALLBACK_FAILED, level: 'warn' },
  { error: 'server_error', location: UNAVAILABLE, level: 'warn' },
  { error: 'temporarily_unavailable', location: UNAVAILABLE, level: 'warn' },
  { error: 'interaction_required', location: CALLBACK_FAILED, level: 'error' },
  { error: 'invalid_request', location: CALLBACK_FAILED, level: 'error' },
];
const TOKEN_ERRORS = [
  { error: 'invalid_grant', location: CALLBACK_FAILED, level: 'warn' },
  { error: 'interaction_required', location: CALLBACK_FAILED, level: 'warn' },
  { error: 'temporarily_unavailable', location: UNAVAILABLE, level: 'warn' },
  { error: 'invalid_client', location: CALLBACK_FAILED, level: 'error' },
];

// ID tokens the route refuses, as `serveIdToken` options.
const REFUSED_ID_TOKENS = [
  { label: 'has no id claim', token: { omit: ['id'] } },
  { label: 'has no name claim', token: { omit: ['name'] } },
  {
    label: 'is signed by a key Edupass does not publish',
    token: { signingKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey },
  },
  {
    label: 'was issued more than 30 seconds in the future',
    token: {
      claims: {
        iat: Math.floor(Date.now() / 1000) + 120,
        nbf: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3720,
      },
    },
  },
];

// A throwaway RSA key and self-signed certificate, made with the openssl CLI once per file, then
// loaded into the env the Edupass module reads.
let keysDir: string;

beforeAll(() => {
  keysDir = mkdtempSync(join(tmpdir(), 'edupass-test-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(keysDir, 'key.pem'),
      '-out',
      join(keysDir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=test-only-edupass',
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

// Makes the token endpoint return a valid Edupass ID token, with the `claims` overrides applied,
// the `omit` claims left out the way Edupass leaves out a claim it has no value for, and signed by
// `signingKey`.
function serveIdToken({
  claims = {},
  omit = [],
  signingKey = idTokenKeys.privateKey,
}: { claims?: Record<string, unknown>; omit?: string[]; signingKey?: KeyObject } = {}): void {
  const iat = Math.floor(Date.now() / 1000);
  const payloadClaims: Record<string, unknown> = {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: ENTRA_SUB,
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
  };
  for (const claim of omit) {
    // `JSON.stringify` drops a claim set to `undefined`, so the ID token leaves it out.
    payloadClaims[claim] = undefined;
  }
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: ID_TOKEN_KID }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadClaims)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), signingKey);
  const idToken = `${header}.${payload}.${signature.toString('base64url')}`;
  tokenResponse = () =>
    new Response(
      JSON.stringify({
        token_type: 'Bearer',
        access_token: 'test-access-token',
        expires_in: 3600,
        scope: 'openid',
        id_token: idToken,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

// Makes the token endpoint answer with the Edupass error `error`.
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

// The routes loaded for the current test, with the env as set in `beforeAll`.
let startGET: typeof import('../+server.js').GET;
let GET: typeof import('./+server.js').GET;

// A stand-in for the learner session. `csrfToken()` masks the raw token with a new one-time
// pad on each call, as the real session does. Each session gets its own raw token.
function buildSession(rawCSRFToken = 'raw-csrf-token') {
  const data = new Map<string, unknown>();
  return {
    data,
    isAuthenticated: false,
    user: null,
    csrfToken: () => mask(rawCSRFToken),
    get: (key: string) => data.get(key) ?? null,
    set: (key: string, value: unknown) => void data.set(key, value),
    del: (key: string) => void data.delete(key),
  };
}

type Session = ReturnType<typeof buildSession>;

/**
 * Runs `/auth/edupass` against the session, the way a learner starts sign-in, and returns the
 * state and PKCE verifier it handed to Edupass. The verifier is the session value whose S256
 * challenge the authorize URL carries. The callback is then judged against whatever that route
 * stored, so these tests do not depend on how the route keeps the state.
 */
async function startSignIn(session: Session, returnTo?: string) {
  const search = returnTo === undefined ? '' : `?return_to=${encodeURIComponent(returnTo)}`;
  const thrown: unknown = await Promise.resolve(
    startGET(
      buildEvent(
        '/(main)/auth/edupass',
        new URL(`http://localhost/auth/edupass${search}`),
        session,
      ),
    ),
  ).catch((err: unknown) => err);
  assert(isRedirect(thrown), 'expected the route to redirect');
  const authURL = new URL(thrown.location);
  const codeVerifier = [...session.data.values()].find(
    (value): value is string =>
      typeof value === 'string' &&
      createHash('sha256').update(value).digest('base64url') ===
        authURL.searchParams.get('code_challenge'),
  );
  assert(codeVerifier !== undefined);
  const state = authURL.searchParams.get('state');
  assert(state !== null, 'no state');

  return { state, codeVerifier };
}

// A request with every field SvelteKit gives a route. The routes read only `url` and `locals`.
function buildEvent<RouteId extends '/(main)/auth/edupass' | '/(main)/auth/edupass/callback'>(
  routeId: RouteId,
  url: URL,
  session: Session,
): RequestEvent<Record<string, never>, RouteId> {
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
    route: { id: routeId },
    setHeaders: vi.fn(),
    url,
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    tracing: { enabled: false, root: {}, current: {} },
  };
}

function callbackEvent(session: Session, query: Record<string, string>) {
  const url = new URL('http://localhost/auth/edupass/callback');
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return buildEvent('/(main)/auth/edupass/callback', url, session);
}

beforeEach(async () => {
  vi.clearAllMocks();
  requests = [];
  serveIdToken();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    let body: URLSearchParams | null = null;
    const initBody = init?.body;
    if (initBody !== undefined && initBody !== null) {
      assert(
        typeof initBody === 'string' || initBody instanceof URLSearchParams,
        'unexpected request body type',
      );
      body = new URLSearchParams(initBody);
    } else if (input instanceof Request && method === 'POST') {
      body = new URLSearchParams(await input.text());
    }
    requests.push({ url, method, body });

    const pathless = url.split('?')[0];
    if (pathless === `${ISSUER}/.well-known/openid-configuration`) {
      return new Response(
        JSON.stringify({
          issuer: ISSUER,
          authorization_endpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
          token_endpoint: TOKEN_ENDPOINT,
          jwks_uri: JWKS_URI,
          response_types_supported: ['code'],
          response_modes_supported: ['query', 'fragment', 'form_post'],
          subject_types_supported: ['pairwise'],
          id_token_signing_alg_values_supported: ['RS256'],
          scopes_supported: ['openid'],
          token_endpoint_auth_methods_supported: ['private_key_jwt'],
          code_challenge_methods_supported: ['S256'],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (pathless === JWKS_URI) {
      const jwk = idTokenKeys.publicKey.export({ format: 'jwk' });
      return new Response(
        JSON.stringify({ keys: [{ ...jwk, kid: ID_TOKEN_KID, use: 'sig', alg: 'RS256' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (pathless === TOKEN_ENDPOINT && method === 'POST') {
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
  ({ GET: startGET } = await import('../+server.js'));
  ({ GET } = await import('./+server.js'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /auth/edupass/callback', () => {
  describe('when the state belongs to another session', () => {
    test('redirects to the login page with an error', async () => {
      const victim = buildSession('victim-csrf-token');
      await startSignIn(victim);
      const { state } = await startSignIn(buildSession('attacker-csrf-token'));

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(victim, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location: CALLBACK_FAILED });
    });

    test('does not redeem the code', async () => {
      const victim = buildSession('victim-csrf-token');
      await startSignIn(victim);
      const { state } = await startSignIn(buildSession('attacker-csrf-token'));

      await Promise.resolve(GET(callbackEvent(victim, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(requests).not.toContainEqual(
        expect.objectContaining({ url: TOKEN_ENDPOINT, method: 'POST' }),
      );
    });

    test('does not sign the learner in', async () => {
      const victim = buildSession('victim-csrf-token');
      await startSignIn(victim);
      const { state } = await startSignIn(buildSession('attacker-csrf-token'));

      await Promise.resolve(GET(callbackEvent(victim, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  describe('when the state is forged', () => {
    test('removes the verifier from the session', async () => {
      const session = buildSession();
      const { codeVerifier } = await startSignIn(session);
      const forgedState = Buffer.from(
        JSON.stringify({ csrf_token: mask('attacker-csrf-token'), return_to: '/unit/42' }),
      ).toString('base64url');

      await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state: forgedState })),
      ).catch(() => undefined);

      expect([...session.data.values()]).not.toContain(codeVerifier);
    });

    test('removes the state from the session', async () => {
      const session = buildSession();
      const { state } = await startSignIn(session);
      const forgedState = Buffer.from(
        JSON.stringify({ csrf_token: mask('attacker-csrf-token'), return_to: '/unit/42' }),
      ).toString('base64url');

      await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state: forgedState })),
      ).catch(() => undefined);

      expect([...session.data.values()]).not.toContain(state);
    });
  });

  describe('when no sign-in was started in the session', () => {
    test('redirects to the login page with an error', async () => {
      const session = buildSession();
      const state = Buffer.from(
        JSON.stringify({ csrf_token: session.csrfToken(), return_to: '/' }),
      ).toString('base64url');

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location: CALLBACK_FAILED });
    });

    test('does not redeem the code', async () => {
      const session = buildSession();
      const state = Buffer.from(
        JSON.stringify({ csrf_token: session.csrfToken(), return_to: '/' }),
      ).toString('base64url');

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(requests).not.toContainEqual(
        expect.objectContaining({ url: TOKEN_ENDPOINT, method: 'POST' }),
      );
    });

    test('does not sign the learner in', async () => {
      const session = buildSession();
      const state = Buffer.from(
        JSON.stringify({ csrf_token: session.csrfToken(), return_to: '/' }),
      ).toString('base64url');

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  describe('Edupass identity', () => {
    test('looks the learner up by the Edupass ID', async () => {
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { edupassId: EDUPASS_ID } }),
      );
    });

    test('never passes the token subject to the database', async () => {
      mockFindUnique.mockResolvedValue(null);
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(JSON.stringify([mockFindUnique.mock.calls, mockCreate.mock.calls])).not.toContain(
        ENTRA_SUB,
      );
    });

    test('never passes the token subject to the session', async () => {
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(JSON.stringify(mockSignIn.mock.calls.map((call) => call[1]))).not.toContain(ENTRA_SUB);
    });
  });

  describe('when a learner has the same Edupass ID', () => {
    test('does not create a learner', async () => {
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('signs that learner in', async () => {
      const session = buildSession();
      const { state } = await startSignIn(session);
      const event = callbackEvent(session, { code: 'auth-code', state });

      await Promise.resolve(GET(event)).catch(() => undefined);

      expect(mockSignIn).toHaveBeenCalledExactlyOnceWith(event, existingLearner);
    });
  });

  describe('when no learner has the Edupass ID', () => {
    test('creates a learner with the Edupass ID, name and chosen email', async () => {
      mockFindUnique.mockResolvedValue(null);
      const session = buildSession();
      const { state } = await startSignIn(session);

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
      const { state } = await startSignIn(session);
      const event = callbackEvent(session, { code: 'auth-code', state });

      await Promise.resolve(GET(event)).catch(() => undefined);

      expect(mockSignIn).toHaveBeenCalledExactlyOnceWith(event, {
        id: '8',
        email: 'ces@example.com',
        name: 'Edupass Learner',
      });
    });

    test.each([
      {
        label: 'no CES email picks notification',
        claims: {},
        omit: ['cesEmail'],
        expected: 'notify@example.com',
      },
      {
        label: 'an empty CES email picks notification',
        claims: { cesEmail: '' },
        omit: [],
        expected: 'notify@example.com',
      },
      {
        label: 'a non-string CES email picks notification',
        claims: { cesEmail: true },
        omit: [],
        expected: 'notify@example.com',
      },
      {
        label: 'only ICON and WOG picks ICON',
        claims: {},
        omit: ['cesEmail', 'notificationEmail'],
        expected: 'icon@example.com',
      },
      {
        label: 'only WOG picks WOG',
        claims: {},
        omit: ['cesEmail', 'notificationEmail', 'iconEmail'],
        expected: 'wog@example.com',
      },
    ])(
      'chooses the email in the order CES, notification, ICON, WOG: $label',
      async ({ claims, omit, expected }) => {
        mockFindUnique.mockResolvedValue(null);
        serveIdToken({ claims, omit });
        const session = buildSession();
        const { state } = await startSignIn(session);

        await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
          () => undefined,
        );

        expect(mockCreate.mock.lastCall?.[0].data.email).toBe(expected);
      },
    );

    test('lowercases the chosen email', async () => {
      mockFindUnique.mockResolvedValue(null);
      serveIdToken({ claims: { cesEmail: 'John.Tan@Example.COM' } });
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockCreate.mock.lastCall?.[0].data.email).toBe('john.tan@example.com');
    });
  });

  describe('when the ID token has none of the four emails', () => {
    test('redirects to the login page with the no-email error', async () => {
      mockFindUnique.mockResolvedValue(null);
      serveIdToken({ omit: ['notificationEmail', 'cesEmail', 'iconEmail', 'wogEmail'] });
      const session = buildSession();
      const { state } = await startSignIn(session);

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location: '/login?error=edupass_no_email' });
    });

    test('does not create a learner', async () => {
      mockFindUnique.mockResolvedValue(null);
      serveIdToken({ omit: ['notificationEmail', 'cesEmail', 'iconEmail', 'wogEmail'] });
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('does not sign the learner in', async () => {
      mockFindUnique.mockResolvedValue(null);
      serveIdToken({ omit: ['notificationEmail', 'cesEmail', 'iconEmail', 'wogEmail'] });
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  describe('when the email already belongs to another learner', () => {
    test('redirects to the login page with the email-taken error', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_email_key`', 'P2002'),
      );
      const session = buildSession();
      const { state } = await startSignIn(session);

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location: '/login?error=edupass_email_taken' });
    });

    test('does not sign the learner in', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_email_key`', 'P2002'),
      );
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockSignIn).not.toHaveBeenCalled();
    });

    test('logs a warning', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_email_key`', 'P2002'),
      );
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(logWarn).toHaveBeenCalled();
    });

    test('does not log an error', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_email_key`', 'P2002'),
      );
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe('when a racing first sign-in created the learner', () => {
    test('redirects to the return_to page', async () => {
      mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(existingLearner);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_edupass_id_key`', 'P2002'),
      );
      const session = buildSession();
      const { state } = await startSignIn(session, '/unit/42');

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location: '/unit/42' });
    });

    test('signs that learner in', async () => {
      mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(existingLearner);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_edupass_id_key`', 'P2002'),
      );
      const session = buildSession();
      const { state } = await startSignIn(session);
      const event = callbackEvent(session, { code: 'auth-code', state });

      await Promise.resolve(GET(event)).catch(() => undefined);

      expect(mockSignIn).toHaveBeenCalledExactlyOnceWith(event, existingLearner);
    });

    test('does not log an error', async () => {
      mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(existingLearner);
      mockCreate.mockRejectedValue(
        new MockKnownRequestError('Unique constraint failed on: `users_edupass_id_key`', 'P2002'),
      );
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe('when creating the learner fails for any other reason', () => {
    test('redirects to the login page with an error', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(new Error('db down'));
      const session = buildSession();
      const { state } = await startSignIn(session);

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location: CALLBACK_FAILED });
    });

    test('does not sign the learner in', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(new Error('db down'));
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockSignIn).not.toHaveBeenCalled();
    });

    test('logs an error', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockRejectedValue(new Error('db down'));
      const session = buildSession();
      const { state } = await startSignIn(session);

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
    const { state } = await startSignIn(session, '/unit/42');

    const result: unknown = await Promise.resolve(
      GET(callbackEvent(session, { code: 'auth-code', state })),
    ).catch((err: unknown) => err);

    expect(result).toMatchObject({ status: 302, location: CALLBACK_FAILED });
  });

  test('redirects to the login page with an error when discovery fails', async () => {
    const session = buildSession();
    const { state } = await startSignIn(session);
    // A fresh Edupass module has no settings loaded, so its discovery throws.
    vi.resetModules();
    const { GET: routeWithoutSettings } = await import('./+server.js');

    const result: unknown = await Promise.resolve(
      routeWithoutSettings(callbackEvent(session, { code: 'auth-code', state })),
    ).catch((err: unknown) => err);

    expect(result).toMatchObject({ status: 302, location: CALLBACK_FAILED });
  });

  describe('Edupass errors from the authorization endpoint', () => {
    test.each(AUTHORIZATION_ERRORS)(
      '$error redirects to $location',
      async ({ error, location }) => {
        const session = buildSession();
        const { state } = await startSignIn(session);

        const result: unknown = await Promise.resolve(
          GET(callbackEvent(session, { error, error_description: 'Trace ID: test', state })),
        ).catch((err: unknown) => err);

        expect(result).toMatchObject({ status: 302, location });
      },
    );

    test.each(AUTHORIZATION_ERRORS)('$error logs at $level', async ({ error, level }) => {
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(
        GET(callbackEvent(session, { error, error_description: 'Trace ID: test', state })),
      ).catch(() => undefined);

      expect(level === 'warn' ? logWarn : logError).toHaveBeenCalled();
    });

    test.each(AUTHORIZATION_ERRORS)(
      '$error logs at no level other than $level',
      async ({ error, level }) => {
        const session = buildSession();
        const { state } = await startSignIn(session);

        await Promise.resolve(
          GET(callbackEvent(session, { error, error_description: 'Trace ID: test', state })),
        ).catch(() => undefined);

        expect(level === 'warn' ? logError : logWarn).not.toHaveBeenCalled();
      },
    );

    test.each(AUTHORIZATION_ERRORS)('$error does not redeem a code', async ({ error }) => {
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(
        GET(callbackEvent(session, { error, error_description: 'Trace ID: test', state })),
      ).catch(() => undefined);

      expect(requests).not.toContainEqual(
        expect.objectContaining({ url: TOKEN_ENDPOINT, method: 'POST' }),
      );
    });
  });

  describe('Edupass errors from the token endpoint', () => {
    test.each(TOKEN_ERRORS)('$error redirects to $location', async ({ error, location }) => {
      serveTokenError(error);
      const session = buildSession();
      const { state } = await startSignIn(session);

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location });
    });

    test.each(TOKEN_ERRORS)('$error logs at $level', async ({ error, level }) => {
      serveTokenError(error);
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(level === 'warn' ? logWarn : logError).toHaveBeenCalled();
    });

    test.each(TOKEN_ERRORS)(
      '$error logs at no level other than $level',
      async ({ error, level }) => {
        serveTokenError(error);
        const session = buildSession();
        const { state } = await startSignIn(session);

        await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
          () => undefined,
        );

        expect(level === 'warn' ? logError : logWarn).not.toHaveBeenCalled();
      },
    );

    test.each(TOKEN_ERRORS)('$error does not create a learner', async ({ error }) => {
      serveTokenError(error);
      mockFindUnique.mockResolvedValue(null);
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockCreate).not.toHaveBeenCalled();
    });

    test.each(TOKEN_ERRORS)('$error does not sign the learner in', async ({ error }) => {
      serveTokenError(error);
      const session = buildSession();
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  describe('redirect after sign-in', () => {
    test('redirects to a site-relative return_to', async () => {
      const session = buildSession();
      const { state } = await startSignIn(session, '/unit/42');

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location: '/unit/42' });
    });

    test('redirects to the home page instead of an external return_to', async () => {
      const session = buildSession();
      const { state } = await startSignIn(session, 'https://attacker.example/glow-login');

      const result: unknown = await Promise.resolve(
        GET(callbackEvent(session, { code: 'auth-code', state })),
      ).catch((err: unknown) => err);

      expect(result).toMatchObject({ status: 302, location: HOME_PATH });
    });
  });

  describe('code exchange and ID token checks', () => {
    test('redeems the code at the token endpoint with the PKCE verifier', async () => {
      const session = buildSession();
      const { state, codeVerifier } = await startSignIn(session);

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
        code_verifier: codeVerifier,
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
      const { state } = await startSignIn(session);

      await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
        () => undefined,
      );

      expect(mockSignIn).toHaveBeenCalledOnce();
    });

    test.each(REFUSED_ID_TOKENS)(
      'redirects to the login page with an error when the ID token $label',
      async ({ token }) => {
        serveIdToken(token);
        const session = buildSession();
        const { state } = await startSignIn(session);

        const result: unknown = await Promise.resolve(
          GET(callbackEvent(session, { code: 'auth-code', state })),
        ).catch((err: unknown) => err);

        expect(result).toMatchObject({ status: 302, location: CALLBACK_FAILED });
      },
    );

    test.each(REFUSED_ID_TOKENS)(
      'does not create a learner when the ID token $label',
      async ({ token }) => {
        serveIdToken(token);
        mockFindUnique.mockResolvedValue(null);
        const session = buildSession();
        const { state } = await startSignIn(session);

        await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
          () => undefined,
        );

        expect(mockCreate).not.toHaveBeenCalled();
      },
    );

    test.each(REFUSED_ID_TOKENS)(
      'does not sign the learner in when the ID token $label',
      async ({ token }) => {
        serveIdToken(token);
        const session = buildSession();
        const { state } = await startSignIn(session);

        await Promise.resolve(GET(callbackEvent(session, { code: 'auth-code', state }))).catch(
          () => undefined,
        );

        expect(mockSignIn).not.toHaveBeenCalled();
      },
    );
  });
});
