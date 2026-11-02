import { createPrivateKey, X509Certificate } from 'node:crypto';

import type * as oauth from 'oauth4webapi';

import { building } from '$app/environment';
import { env } from '$env/dynamic/private';

export const EDUPASS_REDIRECT_URL_PATH = '/auth/edupass/callback';

interface Edupass {
  client: oauth.Client;
}

let edupass: Edupass | undefined;

/**
 * Validates the Edupass settings and keeps them for the other Edupass functions. Does not contact
 * Edupass.
 *
 * @throws Error when a setting is unset, invalid, or expired.
 */
export function loadEdupassSettings(): void {
  if (!building) {
    const { EDUPASS_CLIENT_ID, EDUPASS_CERTIFICATE, EDUPASS_PRIVATE_KEY } = env;
    if (!EDUPASS_CLIENT_ID) {
      throw new Error('EDUPASS_CLIENT_ID is not set.');
    }
    if (!EDUPASS_CERTIFICATE) {
      throw new Error('EDUPASS_CERTIFICATE is not set.');
    }
    if (!EDUPASS_PRIVATE_KEY) {
      throw new Error('EDUPASS_PRIVATE_KEY is not set.');
    }

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
    };
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
