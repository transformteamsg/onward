// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { constants, createPublicKey, verify, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// Mutable env object: the module reads `$env/dynamic/private` when it loads the settings. Each
// test changes only the setting it is about.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

// Throwaway keys, made once per file. The openssl CLI makes each key with a self-signed
// certificate.
let keysDir: string;
let CERTIFICATE_PEM: string;
let PRIVATE_KEY_PEM: string;
let UNRELATED_PRIVATE_KEY_PEM: string;
let EC_CERTIFICATE_PEM: string;
let EC_PRIVATE_KEY_PEM: string;
let SHORT_RSA_CERTIFICATE_PEM: string;
let SHORT_RSA_PRIVATE_KEY_PEM: string;
let DSA_CERTIFICATE_PEM: string;
let DSA_PRIVATE_KEY_PEM: string;

// Writes a new key and a self-signed certificate for it into `keysDir` and returns both PEMs.
// `newkey` is the openssl `-newkey` value plus any `-pkeyopt` flags for it.
function opensslKeyAndCertificate(
  name: string,
  newkey: string[],
): { certificate: string; privateKey: string } {
  const keyPath = join(keysDir, `${name}-key.pem`);
  const certificatePath = join(keysDir, `${name}-cert.pem`);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      ...newkey,
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-days',
      '1',
      '-subj',
      `/CN=${name}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  return {
    certificate: readFileSync(certificatePath, 'utf8'),
    privateKey: readFileSync(keyPath, 'utf8'),
  };
}

beforeAll(() => {
  keysDir = mkdtempSync(join(tmpdir(), 'edupass-test-'));
  const edupass = opensslKeyAndCertificate('test-only-edupass', ['rsa:2048']);
  CERTIFICATE_PEM = edupass.certificate;
  PRIVATE_KEY_PEM = edupass.privateKey;
  UNRELATED_PRIVATE_KEY_PEM = opensslKeyAndCertificate('test-only-unrelated', [
    'rsa:2048',
  ]).privateKey;
  const ec = opensslKeyAndCertificate('test-only-ec', [
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
  ]);
  EC_CERTIFICATE_PEM = ec.certificate;
  EC_PRIVATE_KEY_PEM = ec.privateKey;
  const shortRsa = opensslKeyAndCertificate('test-only-short-rsa', ['rsa:1024']);
  SHORT_RSA_CERTIFICATE_PEM = shortRsa.certificate;
  SHORT_RSA_PRIVATE_KEY_PEM = shortRsa.privateKey;
  // openssl makes a DSA key only from a parameter file.
  const dsaParamsPath = join(keysDir, 'dsa-params.pem');
  execFileSync(
    'openssl',
    [
      'genpkey',
      '-genparam',
      '-algorithm',
      'DSA',
      '-pkeyopt',
      'dsa_paramgen_bits:2048',
      '-out',
      dsaParamsPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const dsa = opensslKeyAndCertificate('test-only-dsa', [`dsa:${dsaParamsPath}`]);
  DSA_CERTIFICATE_PEM = dsa.certificate;
  DSA_PRIVATE_KEY_PEM = dsa.privateKey;
});

afterAll(() => {
  rmSync(keysDir, { recursive: true, force: true });
});

const TENANT = 'test-tenant-0000';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const AUTHORIZATION_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const CLIENT_ID = 'test-client-id-1111';

const DISCOVERY_DOCUMENT = {
  issuer: ISSUER,
  authorization_endpoint: AUTHORIZATION_ENDPOINT,
  token_endpoint: TOKEN_ENDPOINT,
  jwks_uri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
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

beforeEach(() => {
  // Valid settings. Each test changes only the one it is about.
  env.EDUPASS_OIDC_URL = ISSUER;
  env.EDUPASS_CLIENT_ID = CLIENT_ID;
  env.EDUPASS_CERTIFICATE = CERTIFICATE_PEM;
  env.EDUPASS_PRIVATE_KEY = PRIVATE_KEY_PEM;
  vi.stubGlobal('fetch', fetchStub);
  // A fresh module per test, so each one starts with no settings and no cached discovery.
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('loadEdupassSettings', () => {
  test.each([
    'EDUPASS_OIDC_URL',
    'EDUPASS_CLIENT_ID',
    'EDUPASS_CERTIFICATE',
    'EDUPASS_PRIVATE_KEY',
  ])('refuses to start when %s is unset', async (name) => {
    env[name] = undefined;
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow(`${name} is not set.`);
  });

  test.each([
    'EDUPASS_OIDC_URL',
    'EDUPASS_CLIENT_ID',
    'EDUPASS_CERTIFICATE',
    'EDUPASS_PRIVATE_KEY',
  ])('refuses to start when %s is empty', async (name) => {
    env[name] = '';
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow(`${name} is not set.`);
  });

  test('refuses to start when EDUPASS_OIDC_URL is not a URL', async () => {
    env.EDUPASS_OIDC_URL = 'not a url';
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow('EDUPASS_OIDC_URL is not a URL.');
  });

  test('refuses to start when EDUPASS_CERTIFICATE is not a PEM certificate', async () => {
    env.EDUPASS_CERTIFICATE = 'not a certificate';
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow(
      'EDUPASS_CERTIFICATE is not a PEM certificate.',
    );
  });

  test('refuses to start when EDUPASS_PRIVATE_KEY is not a PEM private key', async () => {
    env.EDUPASS_PRIVATE_KEY = 'not a private key';
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow(
      'EDUPASS_PRIVATE_KEY is not a PEM private key.',
    );
  });

  test('refuses to start when the private key does not match the certificate', async () => {
    env.EDUPASS_PRIVATE_KEY = UNRELATED_PRIVATE_KEY_PEM;
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow(
      'EDUPASS_PRIVATE_KEY does not match EDUPASS_CERTIFICATE.',
    );
  });

  test('refuses to start when the key pair is not RSA, even if the pair matches', async () => {
    env.EDUPASS_CERTIFICATE = EC_CERTIFICATE_PEM;
    env.EDUPASS_PRIVATE_KEY = EC_PRIVATE_KEY_PEM;
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow(
      'EDUPASS_PRIVATE_KEY must be an RSA key of at least 2048 bits.',
    );
  });

  test('refuses to start when the certificate has expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new X509Certificate(CERTIFICATE_PEM).validToDate.getTime() + 1000);
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow('EDUPASS_CERTIFICATE has expired.');
  });

  test('refuses to start when the key pair is DSA, even with a 2048-bit modulus', async () => {
    env.EDUPASS_CERTIFICATE = DSA_CERTIFICATE_PEM;
    env.EDUPASS_PRIVATE_KEY = DSA_PRIVATE_KEY_PEM;
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow(
      'EDUPASS_PRIVATE_KEY must be an RSA key of at least 2048 bits.',
    );
  });

  test('refuses to start when the RSA key is shorter than 2048 bits', async () => {
    env.EDUPASS_CERTIFICATE = SHORT_RSA_CERTIFICATE_PEM;
    env.EDUPASS_PRIVATE_KEY = SHORT_RSA_PRIVATE_KEY_PEM;
    const { loadEdupassSettings } = await import('./edupass.js');

    await expect(loadEdupassSettings()).rejects.toThrow(
      'EDUPASS_PRIVATE_KEY must be an RSA key of at least 2048 bits.',
    );
  });
});

describe('getEdupassClient', () => {
  test('refuses to return the client before the settings are loaded', async () => {
    const { getEdupassClient } = await import('./edupass.js');

    expect(() => getEdupassClient()).toThrow('Edupass settings are not loaded.');
  });

  test('returns the client with the configured client ID', async () => {
    const { getEdupassClient, loadEdupassSettings } = await import('./edupass.js');
    await loadEdupassSettings();

    const client = getEdupassClient();

    expect(client).toEqual({ client_id: CLIENT_ID });
  });
});

describe('discoverEdupassAuthorizationServer', () => {
  test('refuses to discover before the settings are loaded', async () => {
    const { discoverEdupassAuthorizationServer } = await import('./edupass.js');

    await expect(discoverEdupassAuthorizationServer()).rejects.toThrow(
      'Edupass settings are not loaded.',
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test('discovers the issuer once and reuses the result', async () => {
    const { discoverEdupassAuthorizationServer, loadEdupassSettings } = await import(
      './edupass.js'
    );
    await loadEdupassSettings();

    const first = await discoverEdupassAuthorizationServer();
    const second = await discoverEdupassAuthorizationServer();

    expect(fetchStub).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  test('shares one discovery between calls that start at the same time', async () => {
    const { discoverEdupassAuthorizationServer, loadEdupassSettings } = await import(
      './edupass.js'
    );
    await loadEdupassSettings();

    const [first, second] = await Promise.all([
      discoverEdupassAuthorizationServer(),
      discoverEdupassAuthorizationServer(),
    ]);

    expect(fetchStub).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  test('retries discovery after a failure instead of caching the failure', async () => {
    const { discoverEdupassAuthorizationServer, loadEdupassSettings } = await import(
      './edupass.js'
    );
    await loadEdupassSettings();
    fetchStub.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(discoverEdupassAuthorizationServer()).rejects.toThrow('fetch failed');
    await expect(discoverEdupassAuthorizationServer()).resolves.toMatchObject({
      authorization_endpoint: AUTHORIZATION_ENDPOINT,
    });

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});

describe('edupassClientAuth', () => {
  test('refuses to sign before the settings are loaded', async () => {
    const { edupassClientAuth } = await import('./edupass.js');

    expect(() =>
      edupassClientAuth(
        { issuer: ISSUER, token_endpoint: TOKEN_ENDPOINT },
        { client_id: CLIENT_ID },
        new URLSearchParams(),
        new Headers(),
      ),
    ).toThrow('Edupass settings are not loaded.');
  });

  test('signs the client assertion with PS256 and carries the certificate thumbprint', async () => {
    const {
      discoverEdupassAuthorizationServer,
      edupassClientAuth,
      getEdupassClient,
      loadEdupassSettings,
    } = await import('./edupass.js');
    await loadEdupassSettings();
    const authorizationServer = await discoverEdupassAuthorizationServer();
    const body = new URLSearchParams();

    await edupassClientAuth(authorizationServer, getEdupassClient(), body, new Headers());

    const assertion = body.get('client_assertion');
    assert(assertion !== null);
    const [headerPart, payloadPart, signaturePart] = assertion.split('.');
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    expect(header.alg).toBe('PS256');
    expect(header.typ).toBe('JWT');
    // Node's SHA-256 fingerprint is hex with colons, so it checks the thumbprint independently.
    expect(header['x5t#S256']).toBe(
      Buffer.from(
        new X509Certificate(CERTIFICATE_PEM).fingerprint256.replaceAll(':', ''),
        'hex',
      ).toString('base64url'),
    );
    expect(
      verify(
        'sha256',
        Buffer.from(`${headerPart}.${payloadPart}`),
        {
          key: createPublicKey(CERTIFICATE_PEM),
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        Buffer.from(signaturePart, 'base64url'),
      ),
    ).toBe(true);
  });

  test('addresses the client assertion to the token endpoint', async () => {
    const {
      discoverEdupassAuthorizationServer,
      edupassClientAuth,
      getEdupassClient,
      loadEdupassSettings,
    } = await import('./edupass.js');
    await loadEdupassSettings();
    const authorizationServer = await discoverEdupassAuthorizationServer();
    const body = new URLSearchParams();

    await edupassClientAuth(authorizationServer, getEdupassClient(), body, new Headers());

    const assertion = body.get('client_assertion');
    assert(assertion !== null);
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.aud).toBe(TOKEN_ENDPOINT);
  });

  test('expires the client assertion 5 to 10 minutes after it becomes valid', async () => {
    const {
      discoverEdupassAuthorizationServer,
      edupassClientAuth,
      getEdupassClient,
      loadEdupassSettings,
    } = await import('./edupass.js');
    await loadEdupassSettings();
    const authorizationServer = await discoverEdupassAuthorizationServer();
    const body = new URLSearchParams();

    await edupassClientAuth(authorizationServer, getEdupassClient(), body, new Headers());

    const assertion = body.get('client_assertion');
    assert(assertion !== null);
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.exp - claims.nbf).toBeGreaterThanOrEqual(300);
    expect(claims.exp - claims.nbf).toBeLessThanOrEqual(600);
  });

  test('gives each client assertion a new jti', async () => {
    const {
      discoverEdupassAuthorizationServer,
      edupassClientAuth,
      getEdupassClient,
      loadEdupassSettings,
    } = await import('./edupass.js');
    await loadEdupassSettings();
    const authorizationServer = await discoverEdupassAuthorizationServer();
    const jtis: unknown[] = [];

    for (let i = 0; i < 2; i++) {
      const body = new URLSearchParams();
      await edupassClientAuth(authorizationServer, getEdupassClient(), body, new Headers());
      const assertion = body.get('client_assertion');
      assert(assertion !== null);
      jtis.push(JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString('utf8')).jti);
    }

    expect(jtis[0]).toEqual(expect.any(String));
    expect(jtis[1]).not.toBe(jtis[0]);
  });
});
