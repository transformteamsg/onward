import { PASSING_SCORE } from '$lib/helpers/constants.js';

export interface QuizGrade {
  /**
   * The number of questions the learner answered correctly.
   */
  correctAnswers: number;
  /**
   * The number of questions in the quiz.
   */
  totalQuestions: number;
  /**
   * The score as a percentage, rounded to the nearest whole number.
   */
  score: number;
  /**
   * `true` when the score reaches {@link PASSING_SCORE}.
   */
  isQuizPassed: boolean;
}

/**
 * Grades a quiz attempt against the stored answers. A selection counts as correct only when it
 * matches the stored answer for that question. A question with no recorded selection counts as
 * incorrect, so a caller cannot raise the score by leaving questions out. A quiz with no questions
 * never passes.
 *
 * @param questionAnswers - Every question in the quiz, with its stored answer index.
 * @param selections - The option index the learner selected, keyed by question ID.
 * @returns The graded outcome of the attempt.
 */
export function gradeQuiz(
  questionAnswers: { id: string; answer: number }[],
  selections: Map<string, number>,
): QuizGrade {
  const totalQuestions = questionAnswers.length;
  const correctAnswers = questionAnswers.filter(
    (questionAnswer) => selections.get(questionAnswer.id) === questionAnswer.answer,
  ).length;
  const score = totalQuestions === 0 ? 0 : Math.round((correctAnswers / totalQuestions) * 100);

  return {
    correctAnswers,
    totalQuestions,
    score,
    isQuizPassed: totalQuestions > 0 && score >= PASSING_SCORE,
  };
}
