import { redirect } from '@sveltejs/kit';
import * as oauth from 'oauth4webapi';

import { HOME_PATH } from '$lib/helpers/index.js';
import {
  discoverEdupassAuthorizationServer,
  EDUPASS_REDIRECT_URL_PATH,
  edupassClientAuth,
  getEdupassClient,
} from '$lib/server/auth/edupass.js';
import { learnerAuth } from '$lib/server/auth/index.js';
import {
  db,
  PrismaClientKnownRequestError,
  type UserFindUniqueArgs,
  type UserGetPayload,
} from '$lib/server/db.js';
import { resolveReturnTo } from '$lib/server/return-to.js';

import type { RequestHandler } from './$types';

/**
 * Completes Edupass sign-in. Checks the state, redeems the code for a validated ID token, finds or
 * creates the learner by Edupass ID, and starts the learner session. Every failure redirects to the
 * login page with an error code.
 *
 * @throws Redirect to the `return_to` page on success, or to the login page with an error code.
 */
export const GET: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'edupass_oidc_callback' });

  // Take the verifier and the state out of the session before any check, so neither can be
  // replayed, whatever the outcome of this callback.
  const codeVerifier = event.locals.session.get<string>('edupassCodeVerifier');
  const expectedState = event.locals.session.get<string>('edupassState');
  event.locals.session.del('edupassCodeVerifier');
  event.locals.session.del('edupassState');

  if (!codeVerifier || !expectedState) {
    logger.error(
      { hasCodeVerifier: !!codeVerifier, hasState: !!expectedState },
      'Missing required values from session',
    );
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  // Check the state on every response, including Edupass error responses. The state carries
  // the session's CSRF token, so a match ties this callback to the sign-in this session started.
  const state = event.url.searchParams.get('state');
  if (!state || state !== expectedState) {
    logger.error({ hasState: !!state }, 'State mismatch between original and callback');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  // Redeem the code with the PKCE verifier and a `private_key_jwt` client assertion, then validate
  // the ID token: its signature against the discovered JWKS, and its `iss`, `aud`, `iat`, `nbf`,
  // and `exp` claims.
  let edupassId: string;
  let name: string;
  let email: string | undefined;
  try {
    const authorizationServer = await discoverEdupassAuthorizationServer();
    const client = getEdupassClient();

    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      authorizationServer,
      client,
      edupassClientAuth,
      oauth.validateAuthResponse(authorizationServer, client, event.url, state),
      event.url.origin + EDUPASS_REDIRECT_URL_PATH,
      codeVerifier,
    );
    const claims = oauth.getValidatedIdTokenClaims(
      await oauth.processAuthorizationCodeResponse(authorizationServer, client, tokenResponse, {
        requireIdToken: true,
      }),
    );
    // oauth4webapi does not verify the ID token signature on its own. Verify it against the JWKS.
    await oauth.validateApplicationLevelSignature(authorizationServer, tokenResponse);

    if (!claims) {
      throw new Error('Edupass returned no ID token');
    }
    // Allow 30 seconds of clock drift.
    if (claims.iat > Math.floor(Date.now() / 1000) + 30) {
      throw new Error('Edupass ID token iat is in the future');
    }

    // The learner is identified by the Edupass `id` claim, never the Entra `sub` claim.
    const idClaim = claims['id'];
    if (typeof idClaim !== 'string' || idClaim === '') {
      throw new Error('Edupass ID token missing claim: id');
    }
    edupassId = idClaim;
    const nameClaim = claims['name'];
    if (typeof nameClaim !== 'string' || nameClaim === '') {
      throw new Error('Edupass ID token missing claim: name');
    }
    name = nameClaim;

    // The first email the learner has, in order: notification, CES, ICON, WOG. Lowercased,
    // because the unique index on `users.email` is case-sensitive.
    email = [
      claims['notificationEmail'],
      claims['cesEmail'],
      claims['iconEmail'],
      claims['wogEmail'],
    ]
      .find((value): value is string => typeof value === 'string' && value !== '')
      ?.toLowerCase();
  } catch (err) {
    // The logger's error serializer records the Edupass `error` and `error_description`, which
    // carries the trace and correlation IDs the Edupass team asks for.
    if (err instanceof oauth.AuthorizationResponseError || err instanceof oauth.ResponseBodyError) {
      // Edupass is down for a moment. The learner can try again.
      if (err.error === 'server_error' || err.error === 'temporarily_unavailable') {
        logger.warn({ err }, 'Edupass is temporarily unavailable');
        return redirect(302, '/login?error=edupass_unavailable');
      }
      // The learner causes these errors, not this app, so they are logged as warnings. The
      // authorization endpoint sends `interaction_required` only for `prompt=none`, which this app
      // never sends, so that code is an app fault there and a learner condition only at the token
      // endpoint.
      if (
        err instanceof oauth.AuthorizationResponseError
          ? err.error === 'access_denied'
          : err.error === 'invalid_grant' || err.error === 'interaction_required'
      ) {
        logger.warn({ err }, 'Edupass did not complete the sign-in');
        return redirect(302, '/login?error=oauth2_callback_failed');
      }
    }
    logger.error({ err }, 'Failed to complete the Edupass callback');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  if (!email) {
    logger.warn({ edupassId }, 'Rejected sign-in from an Edupass account with no email');
    return redirect(302, '/login?error=edupass_no_email');
  }

  const userArgs = {
    select: {
      id: true,
      email: true,
      name: true,
    },
    where: {
      edupassId,
    },
  } satisfies UserFindUniqueArgs;

  let user: UserGetPayload<typeof userArgs> | null;
  try {
    user = await db.user.findUnique(userArgs);
  } catch (err) {
    logger.error({ err, edupassId }, 'Failed to find user');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  if (!user) {
    try {
      user = await db.user.create({
        data: {
          name,
          email,
          edupassId,
        },
        select: userArgs.select,
      });
    } catch (err) {
      if (!(err instanceof PrismaClientKnownRequestError && err.code === 'P2002')) {
        logger.error({ err, edupassId }, 'Failed to create user');
        return redirect(302, '/login?error=oauth2_callback_failed');
      }

      // A unique index refused the insert. When a learner with this Edupass ID now exists, a
      // second first sign-in created it first. Otherwise another learner holds the email, and
      // accounts are never joined.
      try {
        user = await db.user.findUnique(userArgs);
      } catch (findErr) {
        logger.error({ err: findErr, edupassId }, 'Failed to find user');
        return redirect(302, '/login?error=oauth2_callback_failed');
      }
      if (!user) {
        logger.warn({ err, edupassId }, 'Rejected sign-in: the email belongs to another learner');
        return redirect(302, '/login?error=edupass_email_taken');
      }
      logger.info({ edupassId }, 'Another sign-in created the user first');
    }
  }

  try {
    await learnerAuth.signIn(event, {
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    logger.error({ err, edupassId }, 'Failed to sign in user');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  logger.info({ edupassId }, 'Successfully signed in user');

  // The state matched the one this server made, so it is always the base64url JSON from
  // `/auth/edupass`.
  return redirect(
    302,
    resolveReturnTo(
      JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'))['return_to'],
      HOME_PATH,
    ),
  );
};
