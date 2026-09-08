import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

import { nanoid } from '$lib/helpers/index.js';
import { type AdminAccess, verifyAdminAccess } from '$lib/server/auth/admin.js';
import { adminAuth } from '$lib/server/auth/index.js';
import { logger } from '$lib/server/logger.js';

/**
 * A handle that adds a request ID to the response headers and attaches a scoped logger to the
 * event. Downstream handles are expected to use the scoped logger for logging.
 */
const requestLoggingHandle: Handle = async ({ event, resolve }) => {
  const requestId = nanoid();

  event.setHeaders({ 'X-Request-Id': requestId });
  event.locals.logger = logger.child({ requestId, module: 'admin' });

  return resolve(event);
};

/**
 * A handle that enforces authentication and admin authorisation on admin routes.
 * - Requests for google auth (`/admin/auth/google/*`) and `/admin/login` are always allowed through.
 * - Unauthenticated requests are redirected to `/admin/login`.
 * - Every other request is authorised against the `UserAdmin` table on each request. A session is
 *   allowed through only when its id resolves to an active `UserAdmin`. A session that does not,
 *   or a lookup that fails, is signed out and redirected to `/admin/login`.
 *
 * The lookup runs per request on purpose. The session payload only records what was true at
 * sign-in, so trusting it would let a removed or deactivated admin keep access for the whole
 * remaining lifetime of the session.
 */
const routeProtectionHandle: Handle = async ({ event, resolve }) => {
  if (
    event.url.pathname === '/admin/auth/google' ||
    event.url.pathname === '/admin/auth/google/callback' ||
    event.url.pathname === '/admin/login'
  ) {
    return resolve(event);
  }

  if (!event.locals.session.isAuthenticated) {
    return redirect(303, '/admin/login');
  }

  if (!event.locals.session.user) {
    return redirect(303, '/admin/login');
  }

  const user = event.locals.session.user;

  let access: AdminAccess;
  try {
    access = await verifyAdminAccess(user.id);
  } catch (err) {
    event.locals.logger.error(
      { err, email: user.email },
      'Failed to verify admin access; denying the request',
    );
    return redirect(303, '/admin/login?error=server_error');
  }

  if (!access.granted) {
    event.locals.logger.warn(
      { email: user.email, reason: access.reason },
      'Session is not an active admin; denying access to protected route',
    );
    await adminAuth.signOut(event);

    return redirect(
      303,
      access.reason === 'inactive'
        ? '/admin/login?error=inactive'
        : '/admin/login?error=unauthorized',
    );
  }

  return resolve(event);
};

export const handle: Handle = sequence(
  requestLoggingHandle,
  adminAuth.handle,
  routeProtectionHandle,
);
