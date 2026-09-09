import { beforeEach, describe, expect, test, vi } from 'vitest';

import { actions, load } from './+page.server.js';

const UNIT_ID = '0192f0c2-0000-7000-8000-000000000001';
const QUESTION_IDS = [
  '0192f0c2-0000-7000-8000-0000000000a1',
  '0192f0c2-0000-7000-8000-0000000000a2',
  '0192f0c2-0000-7000-8000-0000000000a3',
  '0192f0c2-0000-7000-8000-0000000000a4',
  '0192f0c2-0000-7000-8000-0000000000a5',
];

const {
  mockLearningUnitFindUnique,
  mockQuestionAnswerFindFirst,
  mockLearningJourneyFindUnique,
  mockLearningJourneyUpsert,
  mockValidateCSRFToken,
  mockValkey,
} = vi.hoisted(() => {
  const hashes = new Map<string, Map<string, string>>();

  return {
    mockLearningUnitFindUnique: vi.fn(),
    mockQuestionAnswerFindFirst: vi.fn(),
    mockLearningJourneyFindUnique: vi.fn(),
    mockLearningJourneyUpsert: vi.fn(),
    mockValidateCSRFToken: vi.fn(),
    mockValkey: {
      hashes,
      hset: vi.fn(async (key: string, fields: Record<string, string>) => {
        const hash = hashes.get(key) ?? new Map<string, string>();
        for (const [field, value] of Object.entries(fields)) {
          hash.set(field, value);
        }
        hashes.set(key, hash);
        return Object.keys(fields).length;
      }),
      expire: vi.fn(async () => true),
      hgetall: vi.fn(async (key: string) =>
        [...(hashes.get(key) ?? new Map<string, string>()).entries()].map(([field, value]) => ({
          field,
          value,
        })),
      ),
      del: vi.fn(async (keys: string[]) => {
        for (const key of keys) {
          hashes.delete(key);
        }
        return keys.length;
      }),
    },
  };
});

vi.mock('$lib/server/db', () => ({
  db: {
    learningUnit: { findUnique: mockLearningUnitFindUnique },
    questionAnswer: { findFirst: mockQuestionAnswerFindFirst },
    learningJourney: {
      findUnique: mockLearningJourneyFindUnique,
      upsert: mockLearningJourneyUpsert,
    },
  },
  LearningUnitStatus: { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' },
}));

vi.mock('$lib/server/auth/index.js', () => ({
  learnerAuth: { validateCSRFToken: mockValidateCSRFToken },
}));

vi.mock('$lib/server/valkey', () => ({ valkey: mockValkey }));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};
silentLogger.child.mockReturnValue(silentLogger);

const buildEvent = ({
  user = { id: 'user-1' },
  id = UNIT_ID,
  fields = {},
}: {
  user?: { id: string } | null;
  id?: string;
  fields?: Record<string, string>;
} = {}) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }

  return {
    locals: {
      logger: silentLogger,
      session: { user, csrfToken: () => 'csrf-1' },
    },
    params: { id },
    request: { formData: async () => data },
  } as unknown as Parameters<typeof load>[0];
};

/**
 * Builds the five-question quiz used across the tests. The answer for question `n` is index `n`
 * modulo four, so a wrong selection is easy to construct.
 */
const buildQuestionAnswers = () =>
  QUESTION_IDS.map((id, index) => ({
    id,
    question: `Question ${index + 1}`,
    options: ['A', 'B', 'C', 'D'],
    answer: index % 4,
    explanation: `Explanation ${index + 1}`,
    order: index,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  mockValkey.hashes.clear();
  mockValidateCSRFToken.mockResolvedValue(true);
  mockLearningJourneyFindUnique.mockResolvedValue(null);
  mockLearningJourneyUpsert.mockResolvedValue({});
});

describe('quiz page load', () => {
  test('withholds the answer key and the explanations from the browser', async () => {
    mockLearningUnitFindUnique.mockResolvedValue({
      id: UNIT_ID,
      status: 'PUBLISHED',
      title: 'Unit',
      isRequired: true,
      dueDate: null,
      questionAnswers: buildQuestionAnswers().map(({ id, question, options, order }) => ({
        id,
        question,
        options,
        order,
      })),
    });

    const data = await load(buildEvent());
    if (!data) {
      throw new Error('expected the load to return quiz data');
    }

    const selected = mockLearningUnitFindUnique.mock.calls[0][0].select.questionAnswers.select;
    expect(selected).not.toHaveProperty('answer');
    expect(selected).not.toHaveProperty('explanation');
    for (const questionAnswer of data.questionAnswers) {
      expect(questionAnswer).not.toHaveProperty('answer');
      expect(questionAnswer).not.toHaveProperty('explanation');
    }
  });
});

describe('checkAnswer action', () => {
  const questionAnswer = {
    id: QUESTION_IDS[1],
    options: ['A', 'B', 'C', 'D'],
    answer: 1,
    explanation: 'Explanation 2',
  };

  test('records the selection and returns the feedback for the question', async () => {
    mockQuestionAnswerFindFirst.mockResolvedValue(questionAnswer);
    const event = buildEvent({
      fields: { csrfToken: 'csrf-1', questionAnswerId: QUESTION_IDS[1], selectedOptionIndex: '1' },
    });

    const result = await actions.checkAnswer(event);

    expect(result).toEqual({ isCorrect: true, answer: 1, explanation: 'Explanation 2' });
    expect(mockValkey.hset).toHaveBeenCalledWith(`quiz_attempt:user-1:${UNIT_ID}`, {
      [QUESTION_IDS[1]]: '1',
    });
  });

  test('reports a wrong selection as incorrect but still records it', async () => {
    mockQuestionAnswerFindFirst.mockResolvedValue(questionAnswer);
    const event = buildEvent({
      fields: { csrfToken: 'csrf-1', questionAnswerId: QUESTION_IDS[1], selectedOptionIndex: '3' },
    });

    const result = await actions.checkAnswer(event);

    expect(result).toMatchObject({ isCorrect: false, answer: 1 });
    expect(mockValkey.hset).toHaveBeenCalledWith(`quiz_attempt:user-1:${UNIT_ID}`, {
      [QUESTION_IDS[1]]: '3',
    });
  });

  test('only reads a question that belongs to the published unit', async () => {
    mockQuestionAnswerFindFirst.mockResolvedValue(questionAnswer);
    const event = buildEvent({
      fields: { csrfToken: 'csrf-1', questionAnswerId: QUESTION_IDS[1], selectedOptionIndex: '1' },
    });

    await actions.checkAnswer(event);

    expect(mockQuestionAnswerFindFirst.mock.calls[0][0].where).toEqual({
      id: QUESTION_IDS[1],
      learningUnit: { id: UNIT_ID, status: 'PUBLISHED' },
    });
  });

  test('rejects an option index outside the question options', async () => {
    mockQuestionAnswerFindFirst.mockResolvedValue(questionAnswer);
    const event = buildEvent({
      fields: { csrfToken: 'csrf-1', questionAnswerId: QUESTION_IDS[1], selectedOptionIndex: '4' },
    });

    await expect(actions.checkAnswer(event)).rejects.toMatchObject({ status: 400 });
    expect(mockValkey.hset).not.toHaveBeenCalled();
  });

  test('rejects an invalid CSRF token', async () => {
    mockValidateCSRFToken.mockResolvedValue(false);
    const event = buildEvent({
      fields: { csrfToken: 'bad', questionAnswerId: QUESTION_IDS[1], selectedOptionIndex: '1' },
    });

    await expect(actions.checkAnswer(event)).rejects.toMatchObject({ status: 400 });
    expect(mockQuestionAnswerFindFirst).not.toHaveBeenCalled();
  });

  test('rejects a question ID that is not a UUID', async () => {
    const event = buildEvent({
      fields: { csrfToken: 'csrf-1', questionAnswerId: 'not-a-uuid', selectedOptionIndex: '1' },
    });

    await expect(actions.checkAnswer(event)).rejects.toMatchObject({ status: 400 });
    expect(mockQuestionAnswerFindFirst).not.toHaveBeenCalled();
  });

  test('rejects an option index that is not a whole number', async () => {
    const event = buildEvent({
      fields: {
        csrfToken: 'csrf-1',
        questionAnswerId: QUESTION_IDS[1],
        selectedOptionIndex: '1.5',
      },
    });

    await expect(actions.checkAnswer(event)).rejects.toMatchObject({ status: 400 });
    expect(mockQuestionAnswerFindFirst).not.toHaveBeenCalled();
  });
});

describe('updateLJCompletionStatus action', () => {
  /**
   * Records selections the way the `checkAnswer` action does, so that the completion action grades
   * a realistic attempt.
   */
  const recordSelections = (selections: Record<string, number>) => {
    const hash = new Map<string, string>();
    for (const [questionAnswerId, selectedOptionIndex] of Object.entries(selections)) {
      hash.set(questionAnswerId, selectedOptionIndex.toString());
    }
    mockValkey.hashes.set(`quiz_attempt:user-1:${UNIT_ID}`, hash);
  };

  const mockRequiredUnit = () => {
    mockLearningUnitFindUnique.mockResolvedValue({
      id: UNIT_ID,
      isRequired: true,
      questionAnswers: buildQuestionAnswers().map(({ id, answer }) => ({ id, answer })),
    });
  };

  test('ignores a client-supplied isQuizPassed and fails an attempt with wrong answers', async () => {
    mockRequiredUnit();
    recordSelections({
      [QUESTION_IDS[0]]: 3,
      [QUESTION_IDS[1]]: 3,
      [QUESTION_IDS[2]]: 3,
      [QUESTION_IDS[3]]: 0,
      [QUESTION_IDS[4]]: 3,
    });
    const event = buildEvent({ fields: { csrfToken: 'csrf-1', isQuizPassed: 'true' } });

    const result = await actions.updateLJCompletionStatus(event);

    expect(result).toEqual({ isQuizPassed: false, correctAnswers: 0, totalQuestions: 5 });
    expect(mockLearningJourneyUpsert.mock.calls[0][0]).toMatchObject({
      update: { isCompleted: false, isQuizPassed: false },
      create: { isCompleted: false, isQuizPassed: false },
    });
  });

  test('records a pass with no isQuizPassed field in the submission', async () => {
    mockRequiredUnit();
    recordSelections({
      [QUESTION_IDS[0]]: 0,
      [QUESTION_IDS[1]]: 1,
      [QUESTION_IDS[2]]: 2,
      [QUESTION_IDS[3]]: 3,
      [QUESTION_IDS[4]]: 0,
    });
    const event = buildEvent({ fields: { csrfToken: 'csrf-1' } });

    const result = await actions.updateLJCompletionStatus(event);

    expect(result).toEqual({ isQuizPassed: true, correctAnswers: 5, totalQuestions: 5 });
    expect(mockLearningJourneyUpsert.mock.calls[0][0]).toMatchObject({
      update: { isCompleted: true, isQuizPassed: true, numberOfAttempts: { increment: 1 } },
      create: { isCompleted: true, isQuizPassed: true, numberOfAttempts: 1 },
    });
  });

  test('fails an attempt where no answer was recorded at all', async () => {
    mockRequiredUnit();
    const event = buildEvent({ fields: { csrfToken: 'csrf-1', isQuizPassed: 'true' } });

    const result = await actions.updateLJCompletionStatus(event);

    expect(result).toEqual({ isQuizPassed: false, correctAnswers: 0, totalQuestions: 5 });
  });

  test('clears the recorded attempt once it has been graded', async () => {
    mockRequiredUnit();
    recordSelections({ [QUESTION_IDS[0]]: 0 });
    const event = buildEvent({ fields: { csrfToken: 'csrf-1' } });

    await actions.updateLJCompletionStatus(event);

    expect(mockValkey.del).toHaveBeenCalledWith([`quiz_attempt:user-1:${UNIT_ID}`]);
    expect(mockValkey.hashes.size).toBe(0);
  });

  test('completes a unit that is not required without a pass verdict', async () => {
    mockLearningUnitFindUnique.mockResolvedValue({
      id: UNIT_ID,
      isRequired: false,
      questionAnswers: buildQuestionAnswers().map(({ id, answer }) => ({ id, answer })),
    });
    const event = buildEvent({ fields: { csrfToken: 'csrf-1', isQuizPassed: 'true' } });

    const result = await actions.updateLJCompletionStatus(event);

    expect(result).toMatchObject({ isQuizPassed: null });
    expect(mockLearningJourneyUpsert.mock.calls[0][0]).toMatchObject({
      update: { isCompleted: true, isQuizPassed: null },
      create: { isCompleted: true, isQuizPassed: null },
    });
  });

  test('leaves an already completed journey untouched', async () => {
    mockRequiredUnit();
    mockLearningJourneyFindUnique.mockResolvedValue({ isCompleted: true });
    const event = buildEvent({ fields: { csrfToken: 'csrf-1', isQuizPassed: 'true' } });

    await actions.updateLJCompletionStatus(event);

    expect(mockLearningJourneyUpsert).not.toHaveBeenCalled();
  });

  test('rejects an invalid CSRF token', async () => {
    mockValidateCSRFToken.mockResolvedValue(false);
    const event = buildEvent({ fields: { csrfToken: 'bad', isQuizPassed: 'true' } });

    await expect(actions.updateLJCompletionStatus(event)).rejects.toMatchObject({ status: 400 });
    expect(mockLearningJourneyUpsert).not.toHaveBeenCalled();
  });

  test('rejects a unit ID that is not a UUID', async () => {
    const event = buildEvent({ id: 'not-a-uuid', fields: { csrfToken: 'csrf-1' } });

    await expect(actions.updateLJCompletionStatus(event)).rejects.toMatchObject({ status: 404 });
    expect(mockLearningUnitFindUnique).not.toHaveBeenCalled();
  });
});
