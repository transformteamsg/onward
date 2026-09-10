import { json } from '@sveltejs/kit';

import { learnerAuth } from '$lib/server/auth';
import {
  db,
  type LearningJourneyGetPayload,
  type LearningJourneyUpsertArgs,
  type LearningUnitContentFindFirstArgs,
  type LearningUnitContentGetPayload,
  LearningUnitStatus,
  type QuestionAnswerCountArgs,
} from '$lib/server/db.js';

import type { JSONObject } from '../types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'api_create_update_learning_journey' });

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return json(null, { status: 401 });
  }

  if (event.request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return json(null, { status: 415 });
  }

  let params: JSONObject;
  try {
    params = await event.request.json();
    if (
      !params ||
      typeof params !== 'object' ||
      !('id' in params) ||
      typeof params['id'] !== 'string' ||
      !('lastCheckpoint' in params) ||
      typeof params['lastCheckpoint'] !== 'number' ||
      !('learningUnitContentId' in params) ||
      typeof params['learningUnitContentId'] !== 'string' ||
      !('csrfToken' in params) ||
      typeof params['csrfToken'] !== 'string' ||
      ('hasReachedEnd' in params && typeof params['hasReachedEnd'] !== 'boolean')
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

  const learningUnitId = params.id as string;
  const lastCheckpoint = params.lastCheckpoint as number;
  const learningUnitContentId = params.learningUnitContentId as string;
  const hasReachedEnd = params.hasReachedEnd === true;

  const learningUnitContentArgs = {
    select: { id: true },
    where: {
      id: learningUnitContentId,
      learningUnitId,
      learningUnit: { status: LearningUnitStatus.PUBLISHED },
    },
  } satisfies LearningUnitContentFindFirstArgs;

  let learningUnitContent: LearningUnitContentGetPayload<typeof learningUnitContentArgs> | null;
  try {
    learningUnitContent = await db.learningUnitContent.findFirst(learningUnitContentArgs);
  } catch (err) {
    logger.error({ err }, 'Failed to retrieve learning unit content');
    return json(null, { status: 500 });
  }

  if (!learningUnitContent) {
    logger.warn(
      { userId: user.id, learningUnitId, learningUnitContentId },
      'Content does not belong to a published learning unit',
    );
    return json(null, { status: 404 });
  }

  // Completion is derived here, never read from the request body. A unit that has a quiz
  // completes only when the learner passes that quiz, which the quiz page owns.
  const questionAnswerCountArgs = {
    where: { learningUnitId },
  } satisfies QuestionAnswerCountArgs;

  let isCompleted = false;
  if (hasReachedEnd) {
    try {
      isCompleted = (await db.questionAnswer.count(questionAnswerCountArgs)) === 0;
    } catch (err) {
      logger.error({ err }, 'Failed to retrieve quiz records');
      return json(null, { status: 500 });
    }
  }

  const update: { isCompleted?: boolean } = {};
  if (isCompleted) {
    update.isCompleted = true;
  }

  try {
    await db.$transaction(async (tx) => {
      const learningJourneyArgs = {
        where: {
          userId_learningUnitId: { userId: user.id, learningUnitId },
        },
        update,
        create: {
          userId: user.id,
          learningUnitId,
          isCompleted,
        },
        select: { id: true },
      } satisfies LearningJourneyUpsertArgs;

      const journey: LearningJourneyGetPayload<typeof learningJourneyArgs> =
        await tx.learningJourney.upsert(learningJourneyArgs);

      await tx.learningJourneyCheckpoint.upsert({
        where: {
          learningJourneyId_learningUnitContentId: {
            learningJourneyId: journey.id,
            learningUnitContentId,
          },
        },
        update: { lastCheckpoint },
        create: {
          learningJourneyId: journey.id,
          learningUnitContentId,
          lastCheckpoint,
        },
      });
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create/update learning journey');
    return json(null, { status: 500 });
  }

  return json(null, { status: 200 });
};
