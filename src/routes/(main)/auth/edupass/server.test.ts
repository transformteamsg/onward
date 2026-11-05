// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isRedirect } from '@sveltejs/kit';
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
import { mask, unmask } from '$lib/server/auth/helpers/mask.js';

import type { RequestEvent } from './$types';

// Mutable env object: the Edupass module reads `$env/dynamic/private` when it loads the settings.
// Each test sets the env, then loads a fresh copy of the route and the module.
const env = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env }));

// `$lib/helpers` re-exports the analytics module, which reads the public env at import time.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

// A throwaway RSA key and self-signed certificate, made with the openssl CLI once per file.
let keysDir: string;
let CERTIFICATE_PEM: string;
let PRIVATE_KEY_PEM: string;

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
  CERTIFICATE_PEM = readFileSync(join(keysDir, 'cert.pem'), 'utf8');
  PRIVATE_KEY_PEM = readFileSync(join(keysDir, 'key.pem'), 'utf8');
});

afterAll(() => {
  rmSync(keysDir, { recursive: true, force: true });
});

const TENANT = 'test-tenant-0000';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const AUTHORIZATION_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const JWKS_URI = `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`;
const CLIENT_ID = 'test-client-id-1111';
const CALLBACK_FAILED = '/login?error=oauth2_callback_failed';

const DISCOVERY_DOCUMENT = {
  issuer: ISSUER,
  authorization_endpoint: AUTHORIZATION_ENDPOINT,
  token_endpoint: TOKEN_ENDPOINT,
  jwks_uri: JWKS_URI,
  response_types_supported: ['code'],
  response_modes_supported: ['query', 'fragment', 'form_post'],
  subject_types_supported: ['pairwise'],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid'],
  token_endpoint_auth_methods_supported: ['private_key_jwt'],
  code_challenge_methods_supported: ['S256'],
};

// Answers only the discovery URL, so discovery from any other URL fails.
const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== DISCOVERY_URL) {
    return new Response('not found', { status: 404 });
  }
  return new Response(JSON.stringify(DISCOVERY_DOCUMENT), {
    headers: { 'content-type': 'application/json' },
  });
});

// A real logger that writes nothing. A pino child inherits its log methods from its parent, so
// the spy also sees what the route logs through `logger.child()`.
const silentLogger = pino({ level: 'silent' });
const errorSpy = vi.spyOn(silentLogger, 'error');

const RAW_CSRF_TOKEN = 'raw-csrf-token';

// A stand-in for the learner session. `csrfToken()` masks the raw token with a new one-time
// pad on each call, as the real session does, so two calls never return the same string.
function buildSession() {
  const data = new Map<string, unknown>();
  return {
    data,
    isAuthenticated: false,
    user: null,
    csrfToken: () => mask(RAW_CSRF_TOKEN),
    get: (key: string) => data.get(key) ?? null,
    set: (key: string, value: unknown) => void data.set(key, value),
    del: (key: string) => void data.delete(key),
  };
}

type Session = ReturnType<typeof buildSession>;

let GET: typeof import('./+server.js').GET;

// A request to `/auth/edupass` with every field SvelteKit gives a route. The route reads only
// `url` and `locals`.
function buildEvent(session: Session, search = ''): RequestEvent {
  const url = new URL(`http://localhost/auth/edupass${search}`);
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
    route: { id: '/(main)/auth/edupass' },
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
  env.EDUPASS_OIDC_URL = ISSUER;
  env.EDUPASS_CLIENT_ID = CLIENT_ID;
  env.EDUPASS_CERTIFICATE = CERTIFICATE_PEM;
  env.EDUPASS_PRIVATE_KEY = PRIVATE_KEY_PEM;
  vi.stubGlobal('fetch', fetchStub);

  // A fresh route and Edupass module per test, with the settings loaded as the root `init` hook
  // loads them at startup.
  vi.resetModules();
  const { loadEdupassSettings } = await import('$lib/server/auth/edupass.js');
  await loadEdupassSettings();
  ({ GET } = await import('./+server.js'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /auth/edupass', () => {
  test('keeps a PKCE verifier in the learner session and sends its S256 challenge', async () => {
    const session = buildSession();
    const event = buildEvent(session);

    const thrown: unknown = await Promise.resolve(GET(event)).catch((err: unknown) => err);

    assert(isRedirect(thrown), 'expected the route to redirect');
    const url = new URL(thrown.location);
    const challenge = url.searchParams.get('code_challenge');
    const codeVerifier = [...session.data.values()].find(
      (value): value is string =>
        typeof value === 'string' &&
        createHash('sha256').update(value).digest('base64url') === challenge,
    );
    assert(codeVerifier !== undefined, 'no verifier in the session matches the challenge');
    // RFC 7636 section 4.1: 43 to 128 characters from the unreserved set.
    // https://www.rfc-editor.org/rfc/rfc7636#section-4.1
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toBe(createHash('sha256').update(codeVerifier).digest('base64url'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('creates a new PKCE verifier for each sign-in', async () => {
    const session = buildSession();

    const firstThrown: unknown = await Promise.resolve(GET(buildEvent(session))).catch(
      (err: unknown) => err,
    );
    assert(isRedirect(firstThrown), 'expected the route to redirect');
    const firstChallenge = new URL(firstThrown.location).searchParams.get('code_challenge');
    const firstVerifier = [...session.data.values()].find(
      (value): value is string =>
        typeof value === 'string' &&
        createHash('sha256').update(value).digest('base64url') === firstChallenge,
    );

    const secondThrown: unknown = await Promise.resolve(GET(buildEvent(session))).catch(
      (err: unknown) => err,
    );
    assert(isRedirect(secondThrown), 'expected the route to redirect');
    const secondChallenge = new URL(secondThrown.location).searchParams.get('code_challenge');
    const secondVerifier = [...session.data.values()].find(
      (value): value is string =>
        typeof value === 'string' &&
        createHash('sha256').update(value).digest('base64url') === secondChallenge,
    );

    expect(firstVerifier).toBeDefined();
    expect(secondVerifier).toBeDefined();
    expect(secondVerifier).not.toBe(firstVerifier);
    expect([...session.data.values()]).not.toContain(firstVerifier);
  });

  test("puts the session's CSRF token and the return_to page in the state", async () => {
    const session = buildSession();
    const event = buildEvent(session, '?return_to=%2Funit%2F42');

    const thrown: unknown = await Promise.resolve(GET(event)).catch((err: unknown) => err);

    assert(isRedirect(thrown), 'expected the route to redirect');
    const url = new URL(thrown.location);
    const encodedState = url.searchParams.get('state');
    assert(encodedState !== null, 'no state');
    const state = JSON.parse(Buffer.from(encodedState, 'base64url').toString('utf8'));
    const csrfToken = state['csrf_token'];
    assert(typeof csrfToken === 'string');
    expect(unmask(csrfToken)).toBe(RAW_CSRF_TOKEN);
    expect(state['return_to']).toBe('/unit/42');
  });

  test('puts the home page in the state when no return_to is sent', async () => {
    const session = buildSession();
    const event = buildEvent(session);

    const thrown: unknown = await Promise.resolve(GET(event)).catch((err: unknown) => err);

    assert(isRedirect(thrown), 'expected the route to redirect');
    const url = new URL(thrown.location);
    const encodedState = url.searchParams.get('state');
    assert(encodedState !== null, 'no state');
    const state = JSON.parse(Buffer.from(encodedState, 'base64url').toString('utf8'));
    expect(state['return_to']).toBe(HOME_PATH);
  });

  test('redirects to the Edupass authorize URL with only the expected parameters', async () => {
    const event = buildEvent(buildSession());

    const thrown: unknown = await Promise.resolve(GET(event)).catch((err: unknown) => err);

    assert(isRedirect(thrown), 'expected the route to redirect');
    expect(thrown.status).toBe(307);
    const url = new URL(thrown.location);
    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZATION_ENDPOINT);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/auth/edupass/callback');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.getAll('scope')).toEqual(['openid']);
    expect(url.searchParams.get('response_mode')).toBe('query');
    // The exact key set also proves the route sends no prompt and no domain_hint.
    expect([...new Set(url.searchParams.keys())].sort()).toEqual([
      'client_id',
      'code_challenge',
      'code_challenge_method',
      'redirect_uri',
      'response_mode',
      'response_type',
      'scope',
      'state',
    ]);
  });

  test('sends the same state that the session keeps', async () => {
    const session = buildSession();
    const event = buildEvent(session);

    const thrown: unknown = await Promise.resolve(GET(event)).catch((err: unknown) => err);

    assert(isRedirect(thrown), 'expected the route to redirect');
    const url = new URL(thrown.location);
    const state = url.searchParams.get('state');
    expect(state).toEqual(expect.any(String));
    expect([...session.data.values()]).toContain(state);
  });

  test('redirects to the login page with an error when discovery fails', async () => {
    fetchStub.mockResolvedValueOnce(new Response('server error', { status: 500 }));
    const session = buildSession();
    const event = buildEvent(session);

    await expect(GET(event)).rejects.toMatchObject({ status: 302, location: CALLBACK_FAILED });
    expect(errorSpy).toHaveBeenCalledWith({ err: expect.any(Error) }, expect.any(String));
    expect(session.data.size).toBe(0);
  });

  test('redirects to the login page with an error when discovery has no authorize URL', async () => {
    // JSON drops an undefined field, so the discovery document has no authorization_endpoint.
    fetchStub.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...DISCOVERY_DOCUMENT, authorization_endpoint: undefined }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const session = buildSession();
    const event = buildEvent(session);

    await expect(GET(event)).rejects.toMatchObject({ status: 302, location: CALLBACK_FAILED });
    expect(session.data.size).toBe(0);
  });
});
