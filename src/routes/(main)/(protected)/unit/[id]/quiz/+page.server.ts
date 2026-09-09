import { error, redirect } from '@sveltejs/kit';
import { validate as uuidValidate } from 'uuid';

import { learnerAuth } from '$lib/server/auth/index.js';
import {
  db,
  type LearningJourneyUpsertArgs,
  type LearningUnitFindUniqueArgs,
  type LearningUnitGetPayload,
  LearningUnitStatus,
  type QuestionAnswerFindFirstArgs,
  type QuestionAnswerGetPayload,
} from '$lib/server/db';
import type { Logger } from '$lib/server/logger.js';
import {
  clearQuizAttempt,
  gradeQuiz,
  readQuizSelections,
  recordQuizSelection,
} from '$lib/server/quiz/index.js';

import type { Actions, PageServerLoad, RequestEvent } from './$types';

/**
 * Validates the CSRF token on a form submission, then resolves the learner who made it. Throws a
 * 400 when the token is missing or invalid. Redirects to the login page when the session holds no
 * learner.
 *
 * @param event - The request event for the form action.
 * @param data - The submitted form data.
 * @param logger - The logger scoped to the form action.
 * @returns The learner who made the submission.
 */
async function requireLearner(event: RequestEvent, data: FormData, logger: Logger) {
  const csrfToken = data.get('csrfToken');
  if (!csrfToken || typeof csrfToken !== 'string') {
    logger.warn('CSRF token is missing');
    throw error(400);
  }

  const isValidCSRFToken = await learnerAuth.validateCSRFToken(event, csrfToken);
  if (!isValidCSRFToken) {
    logger.warn('CSRF token is invalid');
    throw error(400);
  }

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return redirect(303, '/login');
  }

  return user;
}

export const load: PageServerLoad = async (event) => {
  const logger = event.locals.logger.child({ handler: 'page_load_quiz' });

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return redirect(303, '/login');
  }

  if (!uuidValidate(event.params.id)) {
    throw error(404);
  }

  const learningUnitArgs = {
    select: {
      id: true,
      status: true,
      title: true,
      isRequired: true,
      dueDate: true,
      questionAnswers: {
        select: {
          id: true,
          question: true,
          options: true,
          order: true,
        },
        orderBy: {
          order: 'asc',
        },
      },
    },
    where: {
      id: event.params.id,
      status: LearningUnitStatus.PUBLISHED,
    },
  } satisfies LearningUnitFindUniqueArgs;

  let learningUnit: LearningUnitGetPayload<typeof learningUnitArgs> | null;
  try {
    learningUnit = await db.learningUnit.findUnique(learningUnitArgs);
  } catch (err) {
    logger.error({ err }, 'Failed to retrieve learning unit with quiz data');
    throw error(500);
  }
  if (!learningUnit) {
    throw error(404);
  }

  if (!learningUnit.questionAnswers.length) {
    logger.warn('No quiz records found');
    return redirect(303, `/unit/${event.params.id}`);
  }

  // `answer` and `explanation` are deliberately absent: both give the answer key away, and the
  // learner must not hold it before answering. The `checkAnswer` action releases them for one
  // question at a time, after the learner commits to a selection.
  return {
    csrfToken: event.locals.session.csrfToken(),
    questionAnswers: learningUnit.questionAnswers,
    learningUnitTitle: learningUnit.title,
    isRequired: learningUnit.isRequired,
    dueDate: learningUnit.dueDate,
  };
};

export const actions: Actions = {
  /**
   * Records the learner's selection for one question, then returns the feedback for it. The
   * selection is held on the server so that `updateLJCompletionStatus` can grade the attempt
   * without trusting the client.
   */
  checkAnswer: async (event) => {
    const logger = event.locals.logger.child({
      handler: 'page_action_check_quiz_answer',
    });

    const data = await event.request.formData();
    const user = await requireLearner(event, data, logger);

    if (!uuidValidate(event.params.id)) {
      throw error(404);
    }

    const questionAnswerId = data.get('questionAnswerId');
    if (
      !questionAnswerId ||
      typeof questionAnswerId !== 'string' ||
      !uuidValidate(questionAnswerId)
    ) {
      logger.warn('Invalid question answer ID');
      throw error(400);
    }

    const rawSelectedOptionIndex = data.get('selectedOptionIndex');
    if (!rawSelectedOptionIndex || typeof rawSelectedOptionIndex !== 'string') {
      logger.warn('Selected option index is missing');
      throw error(400);
    }

    const selectedOptionIndex = Number(rawSelectedOptionIndex);
    if (!Number.isInteger(selectedOptionIndex) || selectedOptionIndex < 0) {
      logger.warn('Invalid selected option index');
      throw error(400);
    }

    const questionAnswerArgs = {
      select: {
        id: true,
        options: true,
        answer: true,
        explanation: true,
      },
      where: {
        id: questionAnswerId,
        learningUnit: {
          id: event.params.id,
          status: LearningUnitStatus.PUBLISHED,
        },
      },
    } satisfies QuestionAnswerFindFirstArgs;

    let questionAnswer: QuestionAnswerGetPayload<typeof questionAnswerArgs> | null;
    try {
      questionAnswer = await db.questionAnswer.findFirst(questionAnswerArgs);
    } catch (err) {
      logger.error({ err }, 'Failed to retrieve quiz question');
      throw error(500);
    }
    if (!questionAnswer) {
      throw error(404);
    }

    if (selectedOptionIndex >= questionAnswer.options.length) {
      logger.warn('Selected option index is out of range');
      throw error(400);
    }

    try {
      await recordQuizSelection(user.id, event.params.id, questionAnswer.id, selectedOptionIndex);
    } catch (err) {
      logger.error({ err }, 'Failed to record quiz answer selection');
      throw error(500);
    }

    return {
      isCorrect: selectedOptionIndex === questionAnswer.answer,
      answer: questionAnswer.answer,
      explanation: questionAnswer.explanation,
    };
  },

  /**
   * Grades the recorded attempt, then writes the completion state for the learning journey. The
   * pass verdict comes from the stored answers only — the client sends no verdict.
   */
  updateLJCompletionStatus: async (event) => {
    const logger = event.locals.logger.child({
      handler: 'page_action_update_learning_unit_completion_status',
    });

    const data = await event.request.formData();
    const user = await requireLearner(event, data, logger);

    if (!uuidValidate(event.params.id)) {
      throw error(404);
    }

    const learningUnitArgs = {
      select: {
        id: true,
        isRequired: true,
        questionAnswers: {
          select: {
            id: true,
            answer: true,
          },
        },
      },
      where: {
        id: event.params.id,
      },
    } satisfies LearningUnitFindUniqueArgs;

    let learningUnit: LearningUnitGetPayload<typeof learningUnitArgs> | null;
    try {
      learningUnit = await db.learningUnit.findUnique(learningUnitArgs);
    } catch (err) {
      logger.error({ err }, 'Failed to retrieve learning unit');
      throw error(500);
    }

    if (!learningUnit) {
      throw error(404);
    }

    let selections: Map<string, number>;
    try {
      selections = await readQuizSelections(user.id, learningUnit.id);
    } catch (err) {
      logger.error({ err }, 'Failed to read recorded quiz answer selections');
      throw error(500);
    }

    const grade = gradeQuiz(learningUnit.questionAnswers, selections);
    // A unit that is not required has no pass or fail verdict, and completing it is enough.
    const isQuizPassed = learningUnit.isRequired ? grade.isQuizPassed : null;

    const learningJourney = await db.learningJourney.findUnique({
      select: { isCompleted: true },
      where: {
        userId_learningUnitId: { userId: user.id, learningUnitId: learningUnit.id },
      },
    });

    // A completed journey is never written again, so a later attempt cannot revoke a pass.
    if (!learningJourney?.isCompleted) {
      const learningJourneyArgs = {
        where: {
          userId_learningUnitId: { userId: user.id, learningUnitId: learningUnit.id },
        },
        update: {
          isCompleted: isQuizPassed ?? true,
          isQuizPassed,
          numberOfAttempts: { increment: 1 },
        },
        create: {
          userId: user.id,
          learningUnitId: learningUnit.id,
          isCompleted: isQuizPassed ?? true,
          isQuizPassed,
          numberOfAttempts: 1,
        },
      } satisfies LearningJourneyUpsertArgs;

      try {
        await db.learningJourney.upsert(learningJourneyArgs);
      } catch (err) {
        logger.error({ err }, 'Failed to update learning journey completion status');
        throw error(500);
      }
    }

    try {
      await clearQuizAttempt(user.id, learningUnit.id);
    } catch (err) {
      // The attempt has been graded and recorded already, so a failed cleanup is not fatal. The
      // key expires on its own, and a fresh attempt overwrites every question it answers.
      logger.warn({ err }, 'Failed to clear recorded quiz answer selections');
    }

    return {
      isQuizPassed,
      correctAnswers: grade.correctAnswers,
      totalQuestions: grade.totalQuestions,
    };
  },
};
