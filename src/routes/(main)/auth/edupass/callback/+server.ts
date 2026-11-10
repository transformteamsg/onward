import { redirect } from '@sveltejs/kit';
import * as oauth from 'oauth4webapi';

import { HOME_PATH } from '$lib/helpers/index.js';
import {
  discoverEdupassAuthorizationServer,
  EDUPASS_REDIRECT_URL_PATH,
  edupassClientAuth,
  getEdupassClient,
  getEdupassRequestOptions,
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

  // The logger's error serializer records the Edupass `error` and `error_description`, which carries
  // the trace and correlation IDs the Edupass team asks for.
  let authorizationServer: oauth.AuthorizationServer;
  try {
    authorizationServer = await discoverEdupassAuthorizationServer();
  } catch (err) {
    logger.error({ err }, 'Failed to discover the Edupass authorization server');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  // Discovery checks that the settings are loaded, so these calls cannot throw.
  const client = getEdupassClient();
  const requestOptions = getEdupassRequestOptions();

  let callbackParameters: URLSearchParams;
  try {
    callbackParameters = oauth.validateAuthResponse(authorizationServer, client, event.url, state);
  } catch (err) {
    if (err instanceof oauth.AuthorizationResponseError) {
      if (err.error === 'server_error' || err.error === 'temporarily_unavailable') {
        logger.warn({ err }, 'Edupass is temporarily unavailable');
        return redirect(302, '/login?error=edupass_unavailable');
      }
      // The learner caused this error, not this app, so it is logged as a warning. The other codes
      // are app faults, including `interaction_required`, which Edupass sends here only for
      // `prompt=none`, and this app never sends that.
      if (err.error === 'access_denied') {
        logger.warn({ err }, 'Edupass did not complete the sign-in');
        return redirect(302, '/login?error=oauth2_callback_failed');
      }
    }
    logger.error({ err }, 'Failed to validate the Edupass authorization response');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await oauth.authorizationCodeGrantRequest(
      authorizationServer,
      client,
      edupassClientAuth,
      callbackParameters,
      event.url.origin + EDUPASS_REDIRECT_URL_PATH,
      codeVerifier,
      requestOptions,
    );
  } catch (err) {
    logger.error({ err }, 'Failed to send the Edupass token request');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  let tokenResult: oauth.TokenEndpointResponse;
  try {
    tokenResult = await oauth.processAuthorizationCodeResponse(
      authorizationServer,
      client,
      tokenResponse,
      { requireIdToken: true },
    );
  } catch (err) {
    if (err instanceof oauth.ResponseBodyError) {
      if (err.error === 'server_error' || err.error === 'temporarily_unavailable') {
        logger.warn({ err }, 'Edupass is temporarily unavailable');
        return redirect(302, '/login?error=edupass_unavailable');
      }
      // The learner caused these errors, not this app, so they are logged as warnings.
      if (err.error === 'invalid_grant' || err.error === 'interaction_required') {
        logger.warn({ err }, 'Edupass did not complete the sign-in');
        return redirect(302, '/login?error=oauth2_callback_failed');
      }
    }
    logger.error({ err }, 'Failed to process the Edupass token response');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  // oauth4webapi does not verify the ID token signature on its own.
  try {
    await oauth.validateApplicationLevelSignature(
      authorizationServer,
      tokenResponse,
      requestOptions,
    );
  } catch (err) {
    logger.error({ err }, 'Failed to verify the Edupass ID token signature');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  const claims = oauth.getValidatedIdTokenClaims(tokenResult);
  if (!claims) {
    logger.error('Edupass returned no ID token');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  // oauth4webapi checks only the type of `iat`. Allow 30 seconds of clock drift.
  if (claims.iat > Math.floor(Date.now() / 1000) + 30) {
    logger.error('Edupass ID token iat is in the future');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  // The learner is identified by the Edupass `id` claim, never the Entra `sub` claim.
  const edupassId = claims['id'];
  if (typeof edupassId !== 'string' || edupassId === '') {
    logger.error('Edupass ID token missing claim: id');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  const name = claims['name'];
  if (typeof name !== 'string' || name === '') {
    logger.error({ edupassId }, 'Edupass ID token missing claim: name');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  // Lowercased, because the unique index on `users.email` is case-sensitive.
  const email = [
    claims['notificationEmail'],
    claims['cesEmail'],
    claims['iconEmail'],
    claims['wogEmail'],
  ]
    .find((value): value is string => typeof value === 'string' && value !== '')
    ?.toLowerCase();

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
