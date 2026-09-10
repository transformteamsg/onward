import { beforeEach, describe, expect, test, vi } from 'vitest';

import { POST } from './+server.js';

const { mockFindMany, mockCreate, mockValidateCSRFToken } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockValidateCSRFToken: vi.fn(),
}));

vi.mock('$lib/server/db', () => ({
  db: {
    collection: { findMany: mockFindMany },
    userProfile: { create: mockCreate },
  },
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

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  mockValidateCSRFToken.mockResolvedValue(true);
});

describe('POST /api/onboarding', () => {
  test('returns 401 when unauthenticated', async () => {
    const event = buildEvent({ user: null });

    const response = await POST(event);

    expect(response.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns 415 when content-type is not application/json', async () => {
    const event = buildEvent({ contentType: 'text/plain' });

    const response = await POST(event);

    expect(response.status).toBe(415);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns 400 when the request JSON fails to parse', async () => {
    const event = buildEvent({ rawBody: '{not json' });

    const response = await POST(event);

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns 422 when fewer than three collectionIds are submitted', async () => {
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c2'],
        frequency: 'QUICK',
        csrfToken: 'token',
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(422);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns 422 when a collectionId entry is not a string', async () => {
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c2', 42],
        frequency: 'QUICK',
        csrfToken: 'token',
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns 422 when required fields are missing or wrong-typed', async () => {
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c2', 'c3'],
        frequency: 'QUICK',
        // csrfToken missing
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(422);
    expect(mockValidateCSRFToken).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns 403 and writes nothing when the csrfToken does not validate', async () => {
    mockValidateCSRFToken.mockResolvedValue(false);
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c2', 'c3'],
        frequency: 'QUICK',
        csrfToken: 'not-a-real-token',
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(403);
    expect(mockValidateCSRFToken).toHaveBeenCalledWith(event, 'not-a-real-token');
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns 200 and writes one interest per submitted id when all ids resolve', async () => {
    mockFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    mockCreate.mockResolvedValue({});
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c2', 'c3'],
        frequency: 'QUICK',
        csrfToken: 'token',
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: ['c1', 'c2', 'c3'] }, isTopic: true },
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('user-1');
    expect(createArgs.data.learningFrequency).toBe('QUICK');
    expect(createArgs.data.interests.create).toEqual([
      { collectionId: 'c1' },
      { collectionId: 'c2' },
      { collectionId: 'c3' },
    ]);
  });

  test('returns 422 and writes nothing when a single id does not resolve', async () => {
    mockFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c2', 'c3'],
        frequency: 'QUICK',
        csrfToken: 'token',
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(422);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalled();
  });

  test('does not create duplicate interests for repeated collectionIds', async () => {
    mockFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    mockCreate.mockResolvedValue({});
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c1', 'c2', 'c3'],
        frequency: 'QUICK',
        csrfToken: 'token',
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(200);
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.data.interests.create).toEqual([
      { collectionId: 'c1' },
      { collectionId: 'c2' },
      { collectionId: 'c3' },
    ]);
  });

  test('returns 500 when the collection lookup fails', async () => {
    mockFindMany.mockRejectedValue(new Error('db down'));
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c2', 'c3'],
        frequency: 'QUICK',
        csrfToken: 'token',
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(500);
    expect(silentLogger.error).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns 500 when the profile write fails', async () => {
    mockFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    mockCreate.mockRejectedValue(new Error('write failed'));
    const event = buildEvent({
      body: {
        collectionIds: ['c1', 'c2', 'c3'],
        frequency: 'QUICK',
        csrfToken: 'token',
      },
    });

    const response = await POST(event);

    expect(response.status).toBe(500);
    expect(silentLogger.error).toHaveBeenCalled();
  });
});
