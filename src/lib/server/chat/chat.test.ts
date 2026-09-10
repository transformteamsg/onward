import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { Role } from '../../../generated/prisma/enums.js';
import type { Logger } from '../logger.js';

const {
  mockCreate,
  mockSearch,
  mockTransaction,
  mockThreadFindFirst,
  mockThreadCreate,
  mockMessageCreateMany,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockSearch: vi.fn(),
  mockTransaction: vi.fn(),
  mockThreadFindFirst: vi.fn(),
  mockThreadCreate: vi.fn(),
  mockMessageCreateMany: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('openai', () => ({
  default: vi.fn(() => ({ chat: { completions: { create: mockCreate } } })),
}));

vi.mock('../weaviate.js', () => ({ search: mockSearch }));

vi.mock('../db.js', () => ({
  db: { $transaction: mockTransaction },
  Role: { USER: 'USER', ASSISTANT: 'ASSISTANT' },
}));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const readAll = async (body: ReadableStream<Uint8Array> | null): Promise<string[]> => {
  if (body === null) {
    throw new Error('expected a response body');
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    events.push(decoder.decode(value));
  }
  return events;
};

const streamChunks = (parts: string[]): AsyncIterable<ChatCompletionChunk> => ({
  async *[Symbol.asyncIterator]() {
    for (const part of parts) {
      yield {
        choices: [{ delta: { content: part }, finish_reason: null }],
      } as unknown as ChatCompletionChunk;
    }
    yield {
      choices: [{ delta: {}, finish_reason: 'stop' }],
    } as unknown as ChatCompletionChunk;
  },
});

const streamWithFinish = (
  parts: string[],
  finishReason: string,
): AsyncIterable<ChatCompletionChunk> => ({
  async *[Symbol.asyncIterator]() {
    for (const part of parts) {
      yield {
        choices: [{ delta: { content: part }, finish_reason: null }],
      } as unknown as ChatCompletionChunk;
    }
    yield {
      choices: [{ delta: {}, finish_reason: finishReason }],
    } as unknown as ChatCompletionChunk;
  },
});

const streamWithRefusal = (): AsyncIterable<ChatCompletionChunk> => ({
  async *[Symbol.asyncIterator]() {
    yield {
      choices: [{ delta: { refusal: 'I cannot answer that.' }, finish_reason: null }],
    } as unknown as ChatCompletionChunk;
  },
});

const structuredCompletion = (query: string): ChatCompletion =>
  ({
    choices: [
      { finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ query }) } },
    ],
  }) as unknown as ChatCompletion;

const hit = (content: string) => ({ learning_unit_id: 'lu', content });

const encode = async (chunks: ChatChunk[]): Promise<string[]> => {
  const source = new ReadableStream<ChatChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const reader = source.pipeThrough(new ChatSseTransformStream()).getReader();
  const events: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    events.push(value);
  }
  return events;
};

afterEach(() => {
  vi.clearAllMocks();
});

import { SCOPE_FALLBACK_MESSAGE } from '../openai.js';
import type { ChatChunk } from './chat.js';
import {
  ChatSseTransformStream,
  createChatStreamResponse,
  saveTurn,
  withOnFinish,
} from './chat.js';

describe('ChatSseTransformStream', () => {
  test('encodes a chunk as a JSON data event', async () => {
    const events = await encode([{ type: 'chunk', message: 'hello' }]);

    expect(events).toEqual(['data: {"type":"chunk","message":"hello"}\n\n']);
  });

  test('encodes an error as a JSON data event', async () => {
    const events = await encode([{ type: 'error', message: 'Service error' }]);

    expect(events).toEqual(['data: {"type":"error","message":"Service error"}\n\n']);
  });

  test('maps the done signal to the [DONE] terminator', async () => {
    const events = await encode([{ type: 'done' }]);

    expect(events).toEqual(['data: [DONE]\n\n']);
  });

  test('does not synthesize [DONE] when the stream closes without a done chunk', async () => {
    const events = await encode([{ type: 'error', message: 'Service error' }]);

    expect(events).not.toContain('data: [DONE]\n\n');
  });
});

describe('withOnFinish', () => {
  test('accumulates chunk text and calls onFinish once on done', async () => {
    const onFinish = vi.fn();
    const source = (async function* () {
      yield { type: 'chunk', message: 'Photo' } as const;
      yield { type: 'chunk', message: 'synthesis' } as const;
      yield { type: 'done' } as const;
    })();

    const seen: ChatChunk[] = [];
    for await (const chunk of withOnFinish(source, onFinish)) {
      seen.push(chunk);
    }

    expect(seen).toEqual([
      { type: 'chunk', message: 'Photo' },
      { type: 'chunk', message: 'synthesis' },
      { type: 'done' },
    ]);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith('Photosynthesis');
  });

  test('does not call onFinish when the stream ends in error', async () => {
    const onFinish = vi.fn();
    const source = (async function* () {
      yield { type: 'chunk', message: 'partial' } as const;
      yield { type: 'error', message: 'Service error' } as const;
    })();

    for await (const chunk of withOnFinish(source, onFinish)) {
      void chunk;
    }

    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe('createChatStreamResponse — first turn (no history)', () => {
  test('skips condensing, searches the raw query, streams SSE, and persists', async () => {
    mockCreate.mockResolvedValueOnce(streamChunks(['Photo', 'synthesis', ' is a process.']));
    mockSearch.mockResolvedValueOnce([hit('Plants convert light to energy.')]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'thread-1' });

    const response = createChatStreamResponse({
      userId: 'user-1',
      query: 'What is photosynthesis?',
      history: [],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith('What is photosynthesis?');
    expect(events).toEqual([
      'data: {"type":"chunk","message":"Photo"}\n\n',
      'data: {"type":"chunk","message":"synthesis"}\n\n',
      'data: {"type":"chunk","message":" is a process."}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(mockMessageCreateMany).toHaveBeenCalledWith({
      data: [
        { threadId: 'thread-1', role: Role.USER, content: 'What is photosynthesis?' },
        { threadId: 'thread-1', role: Role.ASSISTANT, content: 'Photosynthesis is a process.' },
      ],
    });
  });
});

describe('createChatStreamResponse — follow-up turn (with history)', () => {
  test('condenses, searches the standalone query, answers, and persists', async () => {
    mockCreate
      .mockResolvedValueOnce(structuredCompletion('why does Bob attend the meeting'))
      .mockResolvedValueOnce(streamChunks(['Because', ' he was invited.']));
    mockSearch.mockResolvedValueOnce([hit('Bob was invited.')]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'thread-1' });

    const response = createChatStreamResponse({
      userId: 'user-1',
      query: 'why is he there?',
      history: [
        { role: 'user', content: 'Tell me about Bob' },
        { role: 'assistant', content: 'Bob is a character.' },
      ],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockSearch).toHaveBeenCalledWith('why does Bob attend the meeting');
    expect(events).toContainEqual('data: [DONE]\n\n');
    expect(mockMessageCreateMany).toHaveBeenCalledWith({
      data: [
        { threadId: 'thread-1', role: Role.USER, content: 'why is he there?' },
        { threadId: 'thread-1', role: Role.ASSISTANT, content: 'Because he was invited.' },
      ],
    });
  });

  test('passes the answer messages as developer + history + context + question (question last)', async () => {
    mockCreate
      .mockResolvedValueOnce(structuredCompletion('standalone'))
      .mockResolvedValueOnce(streamChunks(['ok']));
    mockSearch.mockResolvedValueOnce([hit('Bob was invited.')]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'thread-1' });

    const response = createChatStreamResponse({
      userId: 'user-1',
      query: 'why is he there?',
      history: [{ role: 'user', content: 'Tell me about Bob' }],
      logger: silentLogger,
    });
    await readAll(response.body);

    const answerCall = mockCreate.mock.calls[1][0];
    expect(answerCall.messages.map((m: { role: string }) => m.role)).toEqual([
      'developer',
      'user',
      'developer',
      'user',
    ]);
    expect(answerCall.messages[2].content).toBe(
      '## Retrieved learning content\n\n- Bob was invited.',
    );
    expect(answerCall.messages[3]).toEqual({ role: 'user', content: 'why is he there?' });
  });
});

describe('createChatStreamResponse — condense content_filter', () => {
  test('emits an SSE error and does not search or persist', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'content_filter', message: { role: 'assistant', content: null } }],
    });

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'why is he there?',
      history: [{ role: 'user', content: 'earlier' }],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(events).toEqual([
      `data: ${JSON.stringify({ type: 'error', message: 'Content flagged' })}\n\n`,
    ]);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe('createChatStreamResponse — relevance gate', () => {
  test('no hits retrieved: emits SCOPE_FALLBACK_MESSAGE, persists it, no answer call', async () => {
    mockSearch.mockResolvedValueOnce([]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'thread-1' });

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'hi there',
      history: [],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(events).toEqual([
      `data: ${JSON.stringify({ type: 'chunk', message: SCOPE_FALLBACK_MESSAGE })}\n\n`,
      'data: [DONE]\n\n',
    ]);
    expect(mockMessageCreateMany).toHaveBeenCalledWith({
      data: [
        { threadId: 'thread-1', role: Role.USER, content: 'hi there' },
        { threadId: 'thread-1', role: Role.ASSISTANT, content: SCOPE_FALLBACK_MESSAGE },
      ],
    });
  });

  test('passes every retrieved hit to the answer call', async () => {
    mockCreate.mockResolvedValueOnce(streamChunks(['ok']));
    mockSearch.mockResolvedValueOnce([hit('first chunk'), hit('second chunk')]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'thread-1' });

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
    });
    await readAll(response.body);

    const answerCall = mockCreate.mock.calls[0][0];
    expect(answerCall.messages[1]).toEqual({
      role: 'developer',
      content: '## Retrieved learning content\n\n- first chunk\n\n- second chunk',
    });
  });

  test('search throws: emits an SSE error and does not persist', async () => {
    mockSearch.mockRejectedValueOnce(new Error('weaviate timeout'));

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(events).toEqual([
      `data: ${JSON.stringify({ type: 'error', message: 'Service error' })}\n\n`,
    ]);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe('createChatStreamResponse — answer terminal parts', () => {
  test('finish_reason length emits an SSE error and skips persistence', async () => {
    mockCreate.mockResolvedValueOnce(streamWithFinish(['half'], 'length'));
    mockSearch.mockResolvedValueOnce([hit('hit')]);

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(events).toContainEqual(
      `data: ${JSON.stringify({ type: 'chunk', message: 'half' })}\n\n`,
    );
    expect(events).toContainEqual(
      `data: ${JSON.stringify({ type: 'error', message: 'Max tokens reached' })}\n\n`,
    );
    expect(events).not.toContain('data: [DONE]\n\n');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('finish_reason content_filter emits an SSE error and skips persistence', async () => {
    mockCreate.mockResolvedValueOnce(streamWithFinish([], 'content_filter'));
    mockSearch.mockResolvedValueOnce([hit('hit')]);

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(events).toContainEqual(
      `data: ${JSON.stringify({ type: 'error', message: 'Content flagged' })}\n\n`,
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('delta.refusal emits an SSE error, logs, and skips persistence', async () => {
    mockCreate.mockResolvedValueOnce(streamWithRefusal());
    mockSearch.mockResolvedValueOnce([hit('hit')]);

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(events).toContainEqual(
      `data: ${JSON.stringify({ type: 'error', message: 'Service error' })}\n\n`,
    );
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u' }),
      'Answer stream failed',
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe('createChatStreamResponse — persistence failure', () => {
  test('success-path transaction failure: emits [DONE], logs the error, no rethrow', async () => {
    mockCreate.mockResolvedValueOnce(streamChunks(['answer']));
    mockSearch.mockResolvedValueOnce([hit('hit')]);
    mockTransaction.mockRejectedValueOnce(new Error('db down'));

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(events).toContainEqual('data: [DONE]\n\n');
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u' }),
      'Failed to persist messages',
    );
  });

  test('gate-path transaction failure: emits [DONE], logs the error, no rethrow', async () => {
    mockSearch.mockResolvedValueOnce([]);
    mockTransaction.mockRejectedValueOnce(new Error('db down'));

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
    });
    const events = await readAll(response.body);

    expect(events).toContainEqual(
      `data: ${JSON.stringify({ type: 'chunk', message: SCOPE_FALLBACK_MESSAGE })}\n\n`,
    );
    expect(events).toContainEqual('data: [DONE]\n\n');
    expect(silentLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u' }),
      'Failed to persist messages',
    );
  });
});

describe('createChatStreamResponse — client disconnect', () => {
  test('completes generation and persists the full turn when the reader cancels mid-stream', async () => {
    mockCreate.mockResolvedValueOnce(streamChunks(['Photo', 'synthesis', ' is a process.']));
    mockSearch.mockResolvedValueOnce([hit('hit')]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'thread-1' });

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
    });
    const body = response.body;
    if (body === null) {
      throw new Error('expected a response body');
    }
    const reader = body.getReader();
    await reader.read();
    await reader.cancel();

    await vi.waitFor(() =>
      expect(mockMessageCreateMany).toHaveBeenCalledWith({
        data: [
          { threadId: 'thread-1', role: Role.USER, content: 'q' },
          { threadId: 'thread-1', role: Role.ASSISTANT, content: 'Photosynthesis is a process.' },
        ],
      }),
    );
  });
});

describe('createChatStreamResponse — onSettled', () => {
  test('fires once after a graceful completion', async () => {
    const onSettled = vi.fn(async () => undefined);
    mockCreate.mockResolvedValueOnce(streamChunks(['answer']));
    mockSearch.mockResolvedValueOnce([hit('hit')]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'thread-1' });

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
      onSettled,
    });
    await readAll(response.body);

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  test('fires after the stream ends in error', async () => {
    const onSettled = vi.fn(async () => undefined);
    mockSearch.mockRejectedValueOnce(new Error('weaviate timeout'));

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
      onSettled,
    });
    await readAll(response.body);

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  test('fires after the reader cancels mid-stream', async () => {
    const onSettled = vi.fn(async () => undefined);
    mockCreate.mockResolvedValueOnce(streamChunks(['Photo', 'synthesis']));
    mockSearch.mockResolvedValueOnce([hit('hit')]);
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'thread-1' });

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
      onSettled,
    });
    const body = response.body;
    if (body === null) {
      throw new Error('expected a response body');
    }
    const reader = body.getReader();
    await reader.read();
    await reader.cancel();

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  test('logs and swallows a throw from the callback', async () => {
    const onSettled = vi.fn(async () => {
      throw new Error('valkey down');
    });
    mockSearch.mockRejectedValueOnce(new Error('weaviate timeout'));

    const response = createChatStreamResponse({
      userId: 'u',
      query: 'q',
      history: [],
      logger: silentLogger,
      onSettled,
    });
    const events = await readAll(response.body);

    expect(events).toContainEqual(
      `data: ${JSON.stringify({ type: 'error', message: 'Service error' })}\n\n`,
    );
    await vi.waitFor(() =>
      expect(silentLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u' }),
        'Failed to settle the chat stream',
      ),
    );
  });
});

describe('saveTurn', () => {
  test('creates a new thread when none is active, then writes both messages', async () => {
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce(null);
    mockThreadCreate.mockResolvedValueOnce({ id: 'new-thread' });

    await saveTurn('u', 'q', 'answer');

    expect(mockThreadCreate).toHaveBeenCalledWith({
      data: { userId: 'u', isActive: true },
      select: { id: true },
    });
    expect(mockMessageCreateMany).toHaveBeenCalledWith({
      data: [
        { threadId: 'new-thread', role: Role.USER, content: 'q' },
        { threadId: 'new-thread', role: Role.ASSISTANT, content: 'answer' },
      ],
    });
  });

  test('reuses the active thread when one exists and does not create a thread', async () => {
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        thread: { findFirst: mockThreadFindFirst, create: mockThreadCreate },
        message: { createMany: mockMessageCreateMany },
      });
    });
    mockThreadFindFirst.mockResolvedValueOnce({ id: 'existing-thread' });

    await saveTurn('u', 'q', 'answer');

    expect(mockThreadCreate).not.toHaveBeenCalled();
    expect(mockMessageCreateMany).toHaveBeenCalledWith({
      data: [
        { threadId: 'existing-thread', role: Role.USER, content: 'q' },
        { threadId: 'existing-thread', role: Role.ASSISTANT, content: 'answer' },
      ],
    });
  });
});
