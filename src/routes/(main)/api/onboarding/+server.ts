import { json } from '@sveltejs/kit';

import { learnerAuth } from '$lib/server/auth';
import {
  type CollectionFindManyArgs,
  type CollectionGetPayload,
  db,
  type UserProfileCreateArgs,
} from '$lib/server/db';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({
    handler: 'api_update_onboarding',
  });

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return json(null, { status: 401 });
  }

  if (event.request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return json(null, { status: 415 });
  }

  let params;
  try {
    params = await event.request.json();
    if (
      !params ||
      typeof params !== 'object' ||
      !('collectionIds' in params) ||
      !Array.isArray(params['collectionIds']) ||
      params['collectionIds'].length < 3 ||
      !params['collectionIds'].every((id: unknown) => typeof id === 'string') ||
      !('frequency' in params) ||
      typeof params['frequency'] !== 'string' ||
      !('csrfToken' in params) ||
      typeof params['csrfToken'] !== 'string'
    ) {
      return json(null, { status: 422 });
    }
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to parse request body');
    return json(null, { status: 400 });
  }

  const isValidCSRFToken = await learnerAuth.validateCSRFToken(event, params.csrfToken);
  if (!isValidCSRFToken) {
    logger.warn('CSRF token is invalid');
    return json(null, { status: 403 });
  }

  const { collectionIds, frequency } = params;

  const uniqueCollectionIds = [...new Set<string>(collectionIds)];

  try {
    const collectionArgs = {
      select: {
        id: true,
      },
      where: {
        id: {
          in: uniqueCollectionIds,
        },
        isTopic: true,
      },
    } satisfies CollectionFindManyArgs;

    const collections: CollectionGetPayload<typeof collectionArgs>[] =
      await db.collection.findMany(collectionArgs);

    if (collections.length !== uniqueCollectionIds.length) {
      const resolvedIds = new Set(collections.map((collection) => collection.id));
      const unresolvedIds = uniqueCollectionIds.filter((id) => !resolvedIds.has(id));
      logger.warn(
        { userId: user.id, submittedIds: uniqueCollectionIds, unresolvedIds },
        'One or more collectionIds did not resolve to a topic collection',
      );
      return json(null, { status: 422 });
    }

    const userProfileArgs = {
      data: {
        userId: user.id,
        learningFrequency: frequency,
        interests: {
          create: collections.map((collection) => ({
            collectionId: collection.id,
          })),
        },
      },
    } satisfies UserProfileCreateArgs;

    await db.userProfile.create(userProfileArgs);
  } catch (err) {
    logger.error({ err }, 'Failed to complete onboarding');
    return json(null, { status: 500 });
  }

  return json(null, { status: 200 });
};
