import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import type { AuthorizationServer } from 'oauth4webapi';

import { discoverEdupassAuthorizationServer, getEdupassClient } from '$lib/server/auth/edupass.js';
import { learnerAuth } from '$lib/server/auth/index.js';
import { type CloudfrontSignedCookiesOutput } from '$lib/server/cloudfront.js';

/**
 * Signs the learner out of Glow, then redirects them to Edupass to sign out there too. Sign-out is
 * a `POST` that carries the session CSRF token, so a cross-site page cannot force it.
 *
 * @throws Redirect to the Edupass logout endpoint, or to the login page when Glow fails to end the
 * session or cannot get the Edupass logout endpoint. Error 400 or 403 when the request or its CSRF
 * token is invalid.
 */
export const POST: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'api_logout' });

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return redirect(303, '/login');
  }

  let data: FormData;
  try {
    data = await event.request.formData();
  } catch (err) {
    logger.error({ err, email: user.email }, 'Failed to parse request body');
    return error(400, 'Malformed request body');
  }

  const csrfToken = data.get('csrfToken');
  if (!csrfToken || typeof csrfToken !== 'string') {
    logger.warn('CSRF token is missing');
    return error(400, 'Missing CSRF token');
  }

  const isValidCSRFToken = await learnerAuth.validateCSRFToken(event, csrfToken);
  if (!isValidCSRFToken) {
    logger.warn('CSRF token is invalid');
    return error(403, 'Invalid CSRF token');
  }

  try {
    await learnerAuth.signOut(event);
  } catch (err) {
    logger.error({ err, email: user.email }, 'Failed to sign out user');
    return redirect(303, '/login?error=logout_failed');
  }

  const cloudFrontCookieNames: (keyof CloudfrontSignedCookiesOutput)[] = [
    'CloudFront-Policy',
    'CloudFront-Signature',
    'CloudFront-Key-Pair-Id',
  ];
  for (const name of cloudFrontCookieNames) {
    event.cookies.delete(name, { path: '/' });
  }

  logger.info({ email: user.email }, 'Successfully signed out user');

  let authorizationServer: AuthorizationServer;
  try {
    authorizationServer = await discoverEdupassAuthorizationServer();
  } catch (err) {
    logger.warn(
      { err, email: user.email, reason: 'Edupass discovery failed' },
      'Signed out of Glow only: the learner is still signed in to Edupass',
    );
    return redirect(303, '/login');
  }

  const { end_session_endpoint } = authorizationServer;
  if (!end_session_endpoint || !URL.canParse(end_session_endpoint)) {
    logger.warn(
      { email: user.email, reason: 'Edupass discovery has no valid end_session_endpoint' },
      'Signed out of Glow only: the learner is still signed in to Edupass',
    );
    return redirect(303, '/login');
  }

  const logoutURL = new URL(end_session_endpoint);
  logoutURL.searchParams.set('client_id', getEdupassClient().client_id);
  logoutURL.searchParams.set('post_logout_redirect_uri', event.url.origin + '/login');

  return redirect(303, logoutURL.href);
};
