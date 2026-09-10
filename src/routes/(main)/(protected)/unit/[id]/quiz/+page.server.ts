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

  // The payload carries no answer key, on every quiz. A browser that holds `answer` can build a
  // passing submission, and a browser that holds `explanation` leaks the reasoning with it. The
  // `checkAnswer` action releases both one question at a time, after the learner commits to a
  // selection that the server has recorded.
  //
  // This holds whether or not the unit is required. A required unit needs it to keep its verdict
  // honest. A unit that is not required keeps it so that both quizzes read the same way to a
  // learner, and so that flipping `isRequired` later exposes nothing that was already shown.
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

    // Every quiz records the selection before the answer is revealed, so that the reveal cannot be
    // replayed into a better one. Only a required unit is graded from the record, but the recording
    // itself is unconditional, so both quizzes behave the same way to a learner.
    let effectiveOptionIndex: number;
    try {
      const recorded = await recordQuizSelection(
        user.id,
        event.params.id,
        questionAnswer.id,
        selectedOptionIndex,
      );
      effectiveOptionIndex = recorded.selectedOptionIndex;
    } catch (err) {
      logger.error({ err }, 'Failed to record quiz answer selection');
      throw error(500);
    }

    // The feedback describes the selection that counts, which on a replayed check is the one
    // already recorded rather than the one just submitted.
    return {
      isCorrect: effectiveOptionIndex === questionAnswer.answer,
      answer: questionAnswer.answer,
      explanation: questionAnswer.explanation,
      selectedOptionIndex: effectiveOptionIndex,
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

    // Only a required unit carries a pass or fail verdict. A unit that is not required completes on
    // whatever the learner answered, which is the behaviour it had before this change.
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
          // Attempts count towards a required unit only. A unit that is not required tracks none,
          // so the column keeps its default of 0.
          ...(learningUnit.isRequired ? { numberOfAttempts: { increment: 1 } } : {}),
        },
        create: {
          userId: user.id,
          learningUnitId: learningUnit.id,
          isCompleted: isQuizPassed ?? true,
          isQuizPassed,
          ...(learningUnit.isRequired ? { numberOfAttempts: 1 } : {}),
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
      // The attempt is graded and recorded already, so a failed cleanup is not fatal. The key
      // expires on its own. A stale key would otherwise bind the next attempt's answers, because
      // the first selection for a question wins.
      logger.warn({ err }, 'Failed to clear recorded quiz answer selections');
    }

    return {
      isQuizPassed,
      correctAnswers: grade.correctAnswers,
      totalQuestions: grade.totalQuestions,
    };
  },
};
