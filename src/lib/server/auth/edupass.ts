import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';

import * as oauth from 'oauth4webapi';

import { building } from '$app/environment';
import { env } from '$env/dynamic/private';

interface Edupass {
  client: oauth.Client;
  issuer: URL;
  signingKey: CryptoKey;
  certificateThumbprint: string;
}

let edupass: Edupass | undefined;
let discovery: Promise<oauth.AuthorizationServer> | null = null;

/**
 * Validates the Edupass settings, imports the signing key, and keeps both for the other Edupass
 * functions. Does not contact Edupass.
 *
 * @throws Error when a setting is unset, invalid, or expired.
 */
export async function loadEdupassSettings(): Promise<void> {
  if (!building) {
    const { EDUPASS_OIDC_URL, EDUPASS_CLIENT_ID, EDUPASS_CERTIFICATE, EDUPASS_PRIVATE_KEY } = env;
    if (!EDUPASS_OIDC_URL) {
      throw new Error('EDUPASS_OIDC_URL is not set.');
    }
    if (!EDUPASS_CLIENT_ID) {
      throw new Error('EDUPASS_CLIENT_ID is not set.');
    }
    if (!EDUPASS_CERTIFICATE) {
      throw new Error('EDUPASS_CERTIFICATE is not set.');
    }
    if (!EDUPASS_PRIVATE_KEY) {
      throw new Error('EDUPASS_PRIVATE_KEY is not set.');
    }

    const issuer = new URL(EDUPASS_OIDC_URL);
    const certificate = new X509Certificate(EDUPASS_CERTIFICATE);
    if (certificate.validToDate <= new Date()) {
      throw new Error('EDUPASS_CERTIFICATE has expired.');
    }
    const privateKey = createPrivateKey(EDUPASS_PRIVATE_KEY);
    if (!certificate.checkPrivateKey(privateKey)) {
      throw new Error('EDUPASS_PRIVATE_KEY does not match EDUPASS_CERTIFICATE.');
    }
    // PS256 needs an RSA key of at least 2048 bits, as RFC 7518 section 3.5 requires.
    // https://www.rfc-editor.org/rfc/rfc7518#section-3.5
    const { asymmetricKeyDetails } = privateKey;
    if (
      privateKey.asymmetricKeyType !== 'rsa' ||
      !asymmetricKeyDetails ||
      !asymmetricKeyDetails.modulusLength ||
      asymmetricKeyDetails.modulusLength < 2048
    ) {
      throw new Error('EDUPASS_PRIVATE_KEY must be an RSA key of at least 2048 bits.');
    }

    edupass = {
      client: { client_id: EDUPASS_CLIENT_ID },
      issuer,
      certificateThumbprint: createHash('sha256').update(certificate.raw).digest('base64url'),
      signingKey: await crypto.subtle.importKey(
        'pkcs8',
        privateKey.export({ format: 'der', type: 'pkcs8' }),
        { name: 'RSA-PSS', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
    };
    discovery = null;
  }
}

/**
 * Returns the OAuth client that identifies Glow to Edupass.
 *
 * @throws Error when the Edupass settings are not loaded.
 */
export function getEdupassClient(): oauth.Client {
  if (!edupass) {
    throw new Error('Edupass settings are not loaded.');
  }
  return edupass.client;
}

/**
 * Authenticates Glow to Edupass in the token request with a signed client assertion.
 *
 * @throws Error when the Edupass settings are not loaded.
 */
export const edupassClientAuth: oauth.ClientAuth = (as, client, body, headers) => {
  if (!edupass) {
    throw new Error('Edupass settings are not loaded.');
  }
  const { signingKey, certificateThumbprint } = edupass;
  return oauth.PrivateKeyJwt(signingKey, {
    [oauth.modifyAssertion]: (header, payload) => {
      header.typ = 'JWT';
      header['x5t#S256'] = certificateThumbprint;
      payload.aud = as.token_endpoint;
      payload.exp = Number(payload.nbf) + 5 * 60;
    },
  })(as, client, body, headers);
};

/**
 * Discovers the Edupass authorization server on first call and reuses it for the process.
 *
 * @throws Error when the Edupass settings are not loaded, or the discovery request fails or
 * returns invalid metadata.
 */
export async function discoverEdupassAuthorizationServer(): Promise<oauth.AuthorizationServer> {
  if (!edupass) {
    throw new Error('Edupass settings are not loaded.');
  }
  const { issuer } = edupass;
  if (!discovery) {
    // A failed discovery clears the cache, so the next sign-in retries instead of failing for the
    // life of the process.
    discovery = oauth
      .discoveryRequest(issuer, { algorithm: 'oidc' })
      .then((response) => oauth.processDiscoveryResponse(issuer, response))
      .catch((error: unknown) => {
        discovery = null;
        throw error;
      });
  }
  return discovery;
}
