import { valkey } from '../valkey';

/**
 * The namespace used for storing quiz attempt selections in Valkey.
 */
const QUIZ_ATTEMPT_NAMESPACE = 'quiz_attempt';
/**
 * The time-to-live (TTL) for quiz attempt selections in Valkey. An abandoned attempt expires
 * instead of occupying memory for ever.
 */
const QUIZ_ATTEMPT_TTL = 4 * 60 * 60;

/**
 * Builds the Valkey key that holds one learner's selections for one unit's quiz.
 *
 * @param userId - The ID of the learner taking the quiz.
 * @param learningUnitId - The ID of the learning unit the quiz belongs to.
 * @returns The namespaced Valkey key.
 */
function buildAttemptKey(userId: string, learningUnitId: string): string {
  return `${QUIZ_ATTEMPT_NAMESPACE}:${userId}:${learningUnitId}`;
}

/**
 * Records the option a learner selected for one question of a unit's quiz. A second selection for
 * the same question replaces the first one.
 *
 * @param userId - The ID of the learner taking the quiz.
 * @param learningUnitId - The ID of the learning unit the quiz belongs to.
 * @param questionAnswerId - The ID of the question the learner answered.
 * @param selectedOptionIndex - The index of the option the learner selected.
 */
export async function recordQuizSelection(
  userId: string,
  learningUnitId: string,
  questionAnswerId: string,
  selectedOptionIndex: number,
): Promise<void> {
  const key = buildAttemptKey(userId, learningUnitId);

  await valkey.hset(key, { [questionAnswerId]: selectedOptionIndex.toString() });
  await valkey.expire(key, QUIZ_ATTEMPT_TTL);
}

/**
 * Reads every selection recorded for a learner's attempt at a unit's quiz. A stored value that is
 * not an integer is dropped, so a corrupt entry cannot count as a correct answer.
 *
 * @param userId - The ID of the learner taking the quiz.
 * @param learningUnitId - The ID of the learning unit the quiz belongs to.
 * @returns The selected option index for each answered question, keyed by question ID.
 */
export async function readQuizSelections(
  userId: string,
  learningUnitId: string,
): Promise<Map<string, number>> {
  const entries = await valkey.hgetall(buildAttemptKey(userId, learningUnitId));
  const selections = new Map<string, number>();

  for (const entry of entries) {
    const selectedOptionIndex = Number(entry.value.toString());
    if (Number.isInteger(selectedOptionIndex)) {
      selections.set(entry.field.toString(), selectedOptionIndex);
    }
  }

  return selections;
}

/**
 * Discards every selection recorded for a learner's attempt at a unit's quiz, so that the next
 * attempt starts from nothing.
 *
 * @param userId - The ID of the learner taking the quiz.
 * @param learningUnitId - The ID of the learning unit the quiz belongs to.
 */
export async function clearQuizAttempt(userId: string, learningUnitId: string): Promise<void> {
  await valkey.del([buildAttemptKey(userId, learningUnitId)]);
}
