import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

import { HOME_PATH, nanoid } from '$lib/helpers/index.js';
import { learnerAuth } from '$lib/server/auth/index.js';
import {
  type CloudfrontSignedCookiesOutput,
  getCloudFrontSignedCookies,
} from '$lib/server/cloudfront.js';
import { logger } from '$lib/server/logger.js';
import { decodeRoutePathname } from '$lib/server/request-path.js';

/**
 * A handle that adds a request ID to the response headers and attaches a scoped logger to the
 * event. Downstream handles are expected to use the scoped logger for logging.
 */
const requestLoggingHandle: Handle = async ({ event, resolve }) => {
  const requestId = nanoid();

  event.setHeaders({ 'X-Request-Id': requestId });
  event.locals.logger = logger.child({ requestId });

  return await resolve(event);
};

/**
 * A handle that enforces authentication on protected routes.
 * - Requests to `/api/*` are always allowed through
 * - Authenticated users visiting `/login` are redirected back to `/`
 * - Unauthenticated users are redirected to `/login`
 */
const routeProtectionHandle: Handle = async ({ event, resolve }) => {
  // Compare the decoded pathname, because SvelteKit matches routes with it. The raw
  // `event.url.pathname` keeps its percent-encoding, so `/%6Cogin` would miss the
  // `/login` tests below while still resolving to the login route.
  //
  // The root hook rejects a malformed pathname before this handle runs, so the
  // fallback is unreachable in practice. It falls back to the raw pathname, which
  // matches none of the paths below and so takes the most restrictive branch.
  const routePathname = decodeRoutePathname(event.url.pathname) ?? event.url.pathname;

  if (routePathname.startsWith('/api/')) {
    return await resolve(event);
  }

  if (event.locals.session.isAuthenticated) {
    if (routePathname === '/login') {
      return redirect(302, HOME_PATH);
    }

    return await resolve(event);
  }

  if (
    routePathname === '/login' ||
    routePathname === '/auth/google' ||
    routePathname === '/auth/google/callback' ||
    routePathname === '/terms' ||
    routePathname === '/privacy'
  ) {
    return await resolve(event);
  }

  // Send the decoded pathname, so `return_to` carries the canonical path. The raw
  // pathname would be encoded a second time here and would then return the user to
  // the encoded form after sign-in.
  return redirect(303, `/login?return_to=${encodeURIComponent(routePathname)}`);
};

const cloudFrontCookieHandle: Handle = async ({ event, resolve }) => {
  if (event.locals.session.isAuthenticated) {
    const ttl = learnerAuth.authenticatedTimeout;

    let signedCookies: CloudfrontSignedCookiesOutput | null;
    try {
      signedCookies = getCloudFrontSignedCookies(ttl);
    } catch (err) {
      event.locals.logger.error({ err }, 'Failed to generate CloudFront signed cookies');
      return await resolve(event);
    }
    if (!signedCookies) {
      return await resolve(event);
    }

    for (const [name, value] of Object.entries(signedCookies)) {
      event.cookies.set(name, value, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: ttl,
      });
    }
  }

  return await resolve(event);
};

export const handle: Handle = sequence(
  requestLoggingHandle,
  learnerAuth.handle,
  routeProtectionHandle,
  cloudFrontCookieHandle,
);
