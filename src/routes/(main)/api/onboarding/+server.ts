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
    // Read the topic catalogue instead of filtering by the submitted ids. The
    // query cost is then independent of the request, so a long `collectionIds`
    // array cannot grow the `in` list, and the catalogue size becomes the
    // ceiling on a valid submission. No arbitrary maximum to keep in sync.
    const topicArgs = {
      select: {
        id: true,
      },
      where: {
        isTopic: true,
      },
    } satisfies CollectionFindManyArgs;

    const topics: CollectionGetPayload<typeof topicArgs>[] =
      await db.collection.findMany(topicArgs);

    const topicIds = new Set(topics.map((topic) => topic.id));

    // Bounds the arrays logged below to the catalogue size.
    if (uniqueCollectionIds.length > topicIds.size) {
      logger.warn(
        {
          userId: user.id,
          submittedCount: uniqueCollectionIds.length,
          topicCount: topicIds.size,
        },
        'More collectionIds submitted than there are topic collections',
      );
      return json(null, { status: 422 });
    }

    const unresolvedIds = uniqueCollectionIds.filter((id) => !topicIds.has(id));

    if (unresolvedIds.length > 0) {
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
          create: uniqueCollectionIds.map((collectionId) => ({
            collectionId,
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
