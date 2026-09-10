import { createHash } from 'node:crypto';

import { CodeChallengeMethod, type LoginTicket, OAuth2Client } from 'google-auth-library';

import { env } from '$env/dynamic/private';

export interface GoogleProfile {
  /**
   * A unique identifier of the Google profile.
   */
  id: string;
  /**
   * The email of the Google profile.
   */
  email: string;
  /**
   * The name of the Google profile.
   */
  name: string;
  /**
   * A URL to the picture of the Google profile, or null if Google did not provide a `picture` claim.
   */
  picture: string | null;
}

/**
 * The path where Google will redirect after a successful authentication.
 */
const GOOGLE_REDIRECT_URL_PATH = '/auth/google/callback';

/**
 * Parses `GOOGLE_HOSTED_DOMAIN` into the list of allowed Google Workspace
 * domains. Accepts a single domain or a comma-separated list; whitespace around
 * entries is ignored and entries are lower-cased so matching is
 * case-insensitive (Google's `hd` claim is always lower-case, so a config like
 * `MOE.edu.sg` would otherwise silently reject every user). Returns an empty
 * array when unset, meaning no hosted-domain restriction is enforced.
 */
function getAllowedHostedDomains(): string[] {
  return (env.GOOGLE_HOSTED_DOMAIN ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
}

function getOAuth2Client() {
  return new OAuth2Client({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
  });
}

/**
 * Generates a Google OAuth2 authorization URL for initiating the authentication flow.
 *
 * @param options.origin - The origin of the application. It is used to construct the redirect URI.
 * @param options.state - A random string to prevent CSRF attacks.
 * @param options.codeVerifier - A cryptographically random string used for PKCE verification.
 * @param options.prompt - A space-delimited list of prompts for authentication.
 * @returns The complete Google OAuth2 authorization URL.
 *
 * @example
 * ```ts
 * const authURL = generateAuthURL({
 *   origin: "https://myapp.com",
 *   state: "random-state-string",
 *   codeVerifier: "random-code-verifier"
 * });
 * // Returns: "https://accounts.google.com/oauth/authorize?..."
 * ```
 */
export function generateAuthURL({
  origin,
  state,
  codeVerifier,
  prompt,
}: {
  origin: string;
  state: string;
  codeVerifier: string;
  prompt?: string;
}): string {
  const client = getOAuth2Client();

  // `hd` is only an account-chooser hint and accepts a single value. With one
  // configured domain we pass it directly; with several we fall back to `*`,
  // which limits the chooser to managed Workspace accounts. The actual
  // restriction is enforced in `verifyIdToken`.
  const allowedDomains = getAllowedHostedDomains();
  const hd =
    allowedDomains.length === 0 ? undefined : allowedDomains.length === 1 ? allowedDomains[0] : '*';

  return client.generateAuthUrl({
    redirect_uri: origin + GOOGLE_REDIRECT_URL_PATH,
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    state,
    code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    code_challenge_method: CodeChallengeMethod.S256,
    hd,
    prompt,
  });
}

/**
 * Exchanges the Google OAuth2 authorization code for a Google ID token.
 *
 * @param options.origin - The origin of the application. It is used to construct the redirect URI.
 * @param options.code - The authorization code received from Google's callback.
 * @param options.codeVerifier - The same code verifier used in `generateGoogleAuthURL` for PKCE verification.
 * @returns The Google ID token or `null` if ID token is missing.
 *
 * @example
 * ```ts
 * const idToken = await exchangeCodeForIdToken({
 *   origin: "https://myapp.com",
 *   code: "authorization-code-from-google",
 *   codeVerifier: "code-verifier"
 * });
 * ```
 */
export async function exchangeCodeForIdToken({
  origin,
  code,
  codeVerifier,
}: {
  origin: string;
  code: string;
  codeVerifier: string;
}): Promise<string | null> {
  const client = getOAuth2Client();

  const { tokens } = await client.getToken({
    redirect_uri: origin + GOOGLE_REDIRECT_URL_PATH,
    code,
    codeVerifier,
  });

  const idToken = tokens.id_token;
  if (!idToken) {
    return null;
  }

  return idToken;
}

/**
 * Verifies the Google ID token and extracts the profile information.
 *
 * Throws `InvalidIdTokenError` when the token cannot be trusted — bad
 * signature, expired, missing claims, or an `aud` claim that names a different
 * OAuth client — and `HostedDomainMismatchError` (a subclass) when the token's
 * hosted domain is not allow-listed.
 *
 * The hosted-domain restriction is enforced on the Google-verified `hd`
 * (Workspace) claim, not on the email address. `hd` is the account's Workspace
 * primary domain, so any account belonging to an allow-listed Workspace is
 * admitted regardless of its email's literal domain (e.g. a secondary or alias
 * domain). This matches the `GOOGLE_HOSTED_DOMAIN` semantics — it lists
 * Workspace domains, not email domains — and is Google's recommended gate.
 *
 * @param idToken - The Google ID token to verify.
 * @returns The Google profile.
 * @throws InvalidIdTokenError
 * @throws HostedDomainMismatchError
 */
export async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
  const client = getOAuth2Client();

  let ticket: LoginTicket;
  try {
    // `audience` binds the check to this application's OAuth client.
    // `google-auth-library` compares the `aud` claim only when an audience is
    // supplied; without it the verifier accepts any token Google signed, for any
    // client. Today the token always comes from our own code exchange, so the
    // check is redundant. It is here so this function stays safe on its own, and
    // not by how its one caller obtains the token.
    ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
  } catch {
    throw new InvalidIdTokenError(`Google ID token rejected by verifier`);
  }

  const payload = ticket.getPayload();
  if (!payload) {
    throw new InvalidIdTokenError('Google ID token payload missing');
  }
  const { sub, email, name, picture } = payload;
  if (!sub || !email || !name) {
    const missing = !sub ? 'sub' : !email ? 'email' : 'name';
    throw new InvalidIdTokenError(`Google ID token missing claim: ${missing}`);
  }

  // Gate on the verified `hd` (Workspace) claim, not the email domain — see the
  // function docstring for why.
  const allowedDomains = getAllowedHostedDomains();
  if (allowedDomains.length > 0 && (!payload.hd || !allowedDomains.includes(payload.hd))) {
    throw new HostedDomainMismatchError(
      'Google ID token hosted domain does not match a configured hosted domain',
    );
  }

  return { id: sub, email, name, picture: picture ?? null };
}

/**
 * Thrown when token verification fails.
 */
export class InvalidIdTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when the token is otherwise valid but its hosted domain is not one of
 * the domains configured in `GOOGLE_HOSTED_DOMAIN`. A subclass of
 * `InvalidIdTokenError` so existing catch-all handling still rejects it, while
 * callers that care can distinguish it to surface a domain-specific message.
 */
export class HostedDomainMismatchError extends InvalidIdTokenError {}
