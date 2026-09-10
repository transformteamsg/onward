import { redirect } from '@sveltejs/kit';

import { HOME_PATH } from '$lib/helpers';
import {
  exchangeCodeForIdToken,
  type GoogleProfile,
  HostedDomainMismatchError,
  learnerAuth,
  verifyIdToken,
} from '$lib/server/auth/index.js';
import {
  db,
  PrismaClientKnownRequestError,
  type UserFindUniqueArgs,
  type UserGetPayload,
} from '$lib/server/db.js';
import { resolveReturnTo } from '$lib/server/return-to.js';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'google_oauth2_callback' });

  const code = event.url.searchParams.get('code');
  const state = event.url.searchParams.get('state');
  if (!code || !state) {
    logger.error(
      {
        hasCode: !!code,
        hasState: !!state,
      },
      'Missing required OAuth2 parameters from URL',
    );
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  const codeVerifier = event.locals.session.get<string>('codeVerifier');
  const authURL = event.locals.session.get<string>('authURL');
  if (!codeVerifier || !authURL) {
    logger.error(
      {
        hasCodeVerifier: !!codeVerifier,
        hasAuthURL: !!authURL,
      },
      'Missing required values from session',
    );
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  const originalState = new URL(authURL).searchParams.get('state');
  if (!originalState || originalState !== state) {
    logger.error('State mismatch between original and callback');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  let idToken: string | null = null;
  try {
    idToken = await exchangeCodeForIdToken({
      origin: event.url.origin,
      code,
      codeVerifier,
    });

    if (!idToken) {
      logger.error('Missing ID token');
      return redirect(302, '/login?error=oauth2_callback_failed');
    }
  } catch (err) {
    logger.error(err, 'Failed to exchange code for ID token');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  let profile: GoogleProfile;
  try {
    profile = await verifyIdToken(idToken);
  } catch (err) {
    if (err instanceof HostedDomainMismatchError) {
      logger.warn({ err }, 'Rejected sign-in from a non-allowed hosted domain');
      return redirect(302, '/login?error=domain_not_allowed');
    }
    logger.error({ err }, 'Failed to verify ID token');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  const userArgs = {
    select: {
      id: true,
      email: true,
      name: true,
      avatarURL: true,
    },
    where: {
      email: profile.email,
    },
  } satisfies UserFindUniqueArgs;

  let user: UserGetPayload<typeof userArgs> | null = null;
  try {
    user = await db.user.findUnique(userArgs);
  } catch (err) {
    logger.error({ err, email: profile.email }, 'Failed to find user');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  if (!user) {
    try {
      user = await db.user.create({
        data: {
          name: profile.name,
          email: profile.email,
          googleProviderId: profile.id,
          avatarURL: profile.picture,
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatarURL: true,
        },
      });
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
        logger.error(
          { err, email: profile.email },
          'Failed to create user due to duplicate constraint',
        );
        return redirect(302, '/login?error=oauth2_callback_failed');
      }

      logger.error({ err, email: profile.email }, 'Failed to create user');
      return redirect(302, '/login?error=oauth2_callback_failed');
    }
  }

  try {
    await learnerAuth.signIn(event, {
      id: user.id.toString(),
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    logger.error({ err, email: user.email }, 'Failed to sign in user');
    return redirect(302, '/login?error=oauth2_callback_failed');
  }

  const rawState = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
  const returnTo = resolveReturnTo(rawState['return_to'], HOME_PATH);

  logger.info({ email: user.email }, 'Successfully signed in user');

  return redirect(302, returnTo);
};
