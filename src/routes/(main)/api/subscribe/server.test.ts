import { beforeEach, describe, expect, test, vi } from 'vitest';

import { POST } from './+server.js';

const { mockUpdate, mockValidateCSRFToken } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockValidateCSRFToken: vi.fn(),
}));

vi.mock('$lib/server/db', () => ({
  db: {
    userProfile: { update: mockUpdate },
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

describe('POST /api/subscribe', () => {
  test('returns 401 when unauthenticated', async () => {
    const event = buildEvent({ user: null });

    const response = await POST(event);

    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('returns 415 when content-type is not application/json', async () => {
    const event = buildEvent({ contentType: 'text/plain' });

    const response = await POST(event);

    expect(response.status).toBe(415);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('returns 400 when the request JSON fails to parse', async () => {
    const event = buildEvent({ rawBody: '{not json' });

    const response = await POST(event);

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('returns 422 when isSubscribed is missing', async () => {
    const event = buildEvent({ body: { csrfToken: 'token' } });

    const response = await POST(event);

    expect(response.status).toBe(422);
    expect(mockValidateCSRFToken).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('returns 422 when csrfToken is missing', async () => {
    const event = buildEvent({ body: { isSubscribed: false } });

    const response = await POST(event);

    expect(response.status).toBe(422);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('returns 403 and writes nothing when the csrfToken does not validate', async () => {
    mockValidateCSRFToken.mockResolvedValue(false);
    const event = buildEvent({ body: { isSubscribed: false, csrfToken: 'not-a-real-token' } });

    const response = await POST(event);

    expect(response.status).toBe(403);
    expect(mockValidateCSRFToken).toHaveBeenCalledWith(event, 'not-a-real-token');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('returns 200 and updates the profile when the csrfToken validates', async () => {
    mockUpdate.mockResolvedValue({});
    const event = buildEvent({ body: { isSubscribed: true, csrfToken: 'token' } });

    const response = await POST(event);

    expect(response.status).toBe(200);
    expect(mockValidateCSRFToken).toHaveBeenCalledWith(event, 'token');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      data: { isSubscribed: true },
      where: { userId: 'user-1' },
    });
  });

  test('returns 500 when the profile write fails', async () => {
    mockUpdate.mockRejectedValue(new Error('write failed'));
    const event = buildEvent({ body: { isSubscribed: false, csrfToken: 'token' } });

    const response = await POST(event);

    expect(response.status).toBe(500);
    expect(silentLogger.error).toHaveBeenCalled();
  });
});
