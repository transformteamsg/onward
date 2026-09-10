import { beforeEach, describe, expect, test, vi } from 'vitest';

import { POST } from './+server.js';

const {
  mockContentFindFirst,
  mockQuestionAnswerCount,
  mockJourneyUpsert,
  mockCheckpointUpsert,
  mockTransaction,
} = vi.hoisted(() => ({
  mockContentFindFirst: vi.fn(),
  mockQuestionAnswerCount: vi.fn(),
  mockJourneyUpsert: vi.fn(),
  mockCheckpointUpsert: vi.fn(),
  mockTransaction: vi.fn(),
}));

const { mockValidateCSRFToken } = vi.hoisted(() => ({
  mockValidateCSRFToken: vi.fn(),
}));

vi.mock('$lib/server/db.js', () => ({
  db: {
    learningUnitContent: { findFirst: mockContentFindFirst },
    questionAnswer: { count: mockQuestionAnswerCount },
    $transaction: mockTransaction,
  },
  LearningUnitStatus: { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' },
}));

vi.mock('$lib/server/auth', () => ({
  learnerAuth: { validateCSRFToken: mockValidateCSRFToken },
}));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};
silentLogger.child.mockReturnValue(silentLogger);

const LEARNING_UNIT_ID = 'unit-1';
const LEARNING_UNIT_CONTENT_ID = 'content-1';

interface BuildEventOptions {
  user?: { id: string } | null;
  contentType?: string | null;
  body?: unknown;
  rawBody?: string;
}

const buildEvent = ({
  user = { id: 'user-1' },
  contentType = 'application/json',
  body,
  rawBody,
}: BuildEventOptions) =>
  ({
    locals: { logger: silentLogger, session: { user } },
    request: {
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
      },
      json: async () => {
        if (rawBody !== undefined) {
          return JSON.parse(rawBody);
        }
        return body;
      },
    },
  }) as unknown as Parameters<typeof POST>[0];

const checkpointBody = (extra: Record<string, unknown> = {}) => ({
  id: LEARNING_UNIT_ID,
  lastCheckpoint: 0,
  learningUnitContentId: LEARNING_UNIT_CONTENT_ID,
  csrfToken: 'token',
  ...extra,
});

const journeyUpdateArgs = () => mockJourneyUpsert.mock.calls[0][0].update;

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  mockValidateCSRFToken.mockResolvedValue(true);
  mockContentFindFirst.mockResolvedValue({ id: LEARNING_UNIT_CONTENT_ID });
  mockQuestionAnswerCount.mockResolvedValue(0);
  mockJourneyUpsert.mockResolvedValue({ id: 'journey-1' });
  mockCheckpointUpsert.mockResolvedValue({});
  mockTransaction.mockImplementation(async (run: (tx: unknown) => Promise<void>) =>
    run({
      learningJourney: { upsert: mockJourneyUpsert },
      learningJourneyCheckpoint: { upsert: mockCheckpointUpsert },
    }),
  );
});

describe('POST /api/learningjourney', () => {
  test('returns 401 when unauthenticated', async () => {
    const event = buildEvent({ user: null, body: checkpointBody() });

    const response = await POST(event);

    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('returns 415 when content-type is not application/json', async () => {
    const event = buildEvent({ contentType: 'text/plain', body: checkpointBody() });

    const response = await POST(event);

    expect(response.status).toBe(415);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('returns 400 when the request JSON fails to parse', async () => {
    const event = buildEvent({ rawBody: '{not json' });

    const response = await POST(event);

    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('returns 422 when a required field is missing', async () => {
    const body = checkpointBody();
    delete (body as Record<string, unknown>).learningUnitContentId;
    const event = buildEvent({ body });

    const response = await POST(event);

    expect(response.status).toBe(422);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('returns 422 when hasReachedEnd is not a boolean', async () => {
    const event = buildEvent({ body: checkpointBody({ hasReachedEnd: 'yes' }) });

    const response = await POST(event);

    expect(response.status).toBe(422);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('returns 403 when the CSRF token is invalid', async () => {
    mockValidateCSRFToken.mockResolvedValue(false);
    const event = buildEvent({ body: checkpointBody() });

    const response = await POST(event);

    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('ignores a client-supplied isCompleted and records the checkpoint only', async () => {
    mockQuestionAnswerCount.mockResolvedValue(3);
    const event = buildEvent({ body: checkpointBody({ isCompleted: true }) });

    const response = await POST(event);

    expect(response.status).toBe(200);
    expect(journeyUpdateArgs()).toEqual({});
    expect(mockJourneyUpsert.mock.calls[0][0].create.isCompleted).toBe(false);
    expect(mockCheckpointUpsert).toHaveBeenCalledTimes(1);
    expect(mockCheckpointUpsert.mock.calls[0][0].update).toEqual({ lastCheckpoint: 0 });
  });

  test('leaves the journey incomplete when the unit has a quiz and the content ends', async () => {
    mockQuestionAnswerCount.mockResolvedValue(3);
    const event = buildEvent({ body: checkpointBody({ hasReachedEnd: true }) });

    const response = await POST(event);

    expect(response.status).toBe(200);
    expect(mockQuestionAnswerCount).toHaveBeenCalledWith({
      where: { learningUnitId: LEARNING_UNIT_ID },
    });
    expect(journeyUpdateArgs()).toEqual({});
  });

  test('completes the journey when the unit has no quiz and the content ends', async () => {
    mockQuestionAnswerCount.mockResolvedValue(0);
    const event = buildEvent({ body: checkpointBody({ hasReachedEnd: true }) });

    const response = await POST(event);

    expect(response.status).toBe(200);
    expect(journeyUpdateArgs()).toEqual({ isCompleted: true });
    expect(mockJourneyUpsert.mock.calls[0][0].create.isCompleted).toBe(true);
  });

  test('does not count quiz questions when the content has not ended', async () => {
    const event = buildEvent({ body: checkpointBody() });

    const response = await POST(event);

    expect(response.status).toBe(200);
    expect(mockQuestionAnswerCount).not.toHaveBeenCalled();
    expect(journeyUpdateArgs()).toEqual({});
  });

  test('returns 404 when the content does not belong to a published unit', async () => {
    mockContentFindFirst.mockResolvedValue(null);
    const event = buildEvent({ body: checkpointBody({ hasReachedEnd: true }) });

    const response = await POST(event);

    expect(response.status).toBe(404);
    expect(mockContentFindFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: LEARNING_UNIT_CONTENT_ID,
        learningUnitId: LEARNING_UNIT_ID,
        learningUnit: { status: 'PUBLISHED' },
      },
    });
    expect(mockQuestionAnswerCount).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('returns 500 when the content lookup fails', async () => {
    mockContentFindFirst.mockRejectedValue(new Error('db down'));
    const event = buildEvent({ body: checkpointBody() });

    const response = await POST(event);

    expect(response.status).toBe(500);
    expect(silentLogger.error).toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('returns 500 when the quiz count fails', async () => {
    mockQuestionAnswerCount.mockRejectedValue(new Error('db down'));
    const event = buildEvent({ body: checkpointBody({ hasReachedEnd: true }) });

    const response = await POST(event);

    expect(response.status).toBe(500);
    expect(silentLogger.error).toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('returns 500 when the journey write fails', async () => {
    mockJourneyUpsert.mockRejectedValue(new Error('write failed'));
    const event = buildEvent({ body: checkpointBody() });

    const response = await POST(event);

    expect(response.status).toBe(500);
    expect(silentLogger.error).toHaveBeenCalled();
  });
});
