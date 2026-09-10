import { error, redirect, type RequestHandler } from '@sveltejs/kit';

import { adminAuth } from '$lib/server/auth/index.js';

/**
 * Signs the admin out.
 *
 * Sign-out changes state, so it is a `POST` that carries the session CSRF token. A `GET` handler
 * lets a third-party page end the session with a top-level navigation: the session cookie is
 * `sameSite: 'lax'`, so the browser sends it on a cross-site `GET` navigation. The token makes the
 * request unforgeable, because the CSRF cookie is `httpOnly` and a cross-origin page cannot read
 * it.
 *
 * Failures are reported as an error page, not as a redirect, so a rejected request never looks
 * like a successful sign-out. The `Accept` header of a browser form submission selects the HTML
 * error page over the JSON error body.
 */
export const POST: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'api_logout' });

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return redirect(303, '/admin/login');
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

  const isValidCSRFToken = await adminAuth.validateCSRFToken(event, csrfToken);
  if (!isValidCSRFToken) {
    logger.warn('CSRF token is invalid');
    return error(403, 'Invalid CSRF token');
  }

  try {
    await adminAuth.signOut(event);
  } catch (err) {
    logger.error({ err, email: user.email }, 'Failed to sign out user');
    return redirect(303, '/admin/login');
  }

  logger.info({ email: user.email }, 'Successfully signed out user');

  return redirect(303, '/admin/login');
};
