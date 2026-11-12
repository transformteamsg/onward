import { redirect } from '@sveltejs/kit';
import * as oauth from 'oauth4webapi';

import { HOME_PATH } from '$lib/helpers/index.js';
import {
  discoverEdupassAuthorizationServer,
  EDUPASS_REDIRECT_URL_PATH,
  getEdupassClient,
} from '$lib/server/auth/edupass.js';

import type { RequestHandler } from './$types';

/**
 * Starts Edupass sign-in. Keeps a new PKCE verifier and state in the learner session, then
 * redirects to the Edupass authorization endpoint.
 *
 * @throws Redirect to the Edupass authorization endpoint, or to the login page on failure.
 */
export const GET: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'edupass_oidc_initiate' });

  const state = Buffer.from(
    JSON.stringify({
      csrf_token: event.locals.session.csrfToken(),
      return_to: event.url.searchParams.get('return_to') || HOME_PATH,
    }),
  ).toString('base64url');

  const codeVerifier = oauth.generateRandomCodeVerifier();
  let authURL: URL;
  try {
    const { authorization_endpoint } = await discoverEdupassAuthorizationServer();
    if (!authorization_endpoint) {
      throw new Error('Edupass discovery has no authorization_endpoint.');
    }

    authURL = new URL(authorization_endpoint);
    authURL.searchParams.set('client_id', getEdupassClient().client_id);
    authURL.searchParams.set('redirect_uri', event.url.origin + EDUPASS_REDIRECT_URL_PATH);
    authURL.searchParams.set('response_type', 'code');
    authURL.searchParams.set('response_mode', 'query');
    authURL.searchParams.set('scope', 'openid');
    authURL.searchParams.set('state', state);
    authURL.searchParams.set(
      'code_challenge',
      await oauth.calculatePKCECodeChallenge(codeVerifier),
    );
    authURL.searchParams.set('code_challenge_method', 'S256');
  } catch (err) {
    logger.error({ err }, 'Failed to build the Edupass authorization URL');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  event.locals.session.set('edupassCodeVerifier', codeVerifier);
  event.locals.session.set('edupassState', state);

  logger.info('Redirecting to Edupass authorization URL');

  return redirect(307, authURL.href);
};
