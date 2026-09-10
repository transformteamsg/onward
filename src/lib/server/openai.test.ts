import type { ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Logger } from './logger.js';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('openai', () => ({
  // Must be a function expression, not an arrow: the client is built with `new OpenAI(…)`,
  // and Vitest 4 constructs the mock implementation directly.
  default: vi.fn(function () {
    return { chat: { completions: { create: mockCreate } } };
  }),
}));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const streamChunks = (
  parts: string[],
  finishReason = 'stop',
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

const streamRefusal = (): AsyncIterable<ChatCompletionChunk> => ({
  async *[Symbol.asyncIterator]() {
    yield {
      choices: [{ delta: { refusal: 'I cannot answer that.' }, finish_reason: null }],
    } as unknown as ChatCompletionChunk;
  },
});

const streamNoFinish = (parts: string[]): AsyncIterable<ChatCompletionChunk> => ({
  async *[Symbol.asyncIterator]() {
    for (const part of parts) {
      yield {
        choices: [{ delta: { content: part }, finish_reason: null }],
      } as unknown as ChatCompletionChunk;
    }
  },
});

const collect = async <T>(gen: AsyncGenerator<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const part of gen) {
    out.push(part);
  }
  return out;
};

afterEach(() => {
  vi.clearAllMocks();
});

import {
  CONDENSE_QUESTION_MESSAGE,
  CONDENSE_QUESTION_SCHEMA,
  condenseQuestion,
  createAnswerStream,
  DEVELOPER_MESSAGE,
  SCOPE_FALLBACK_MESSAGE,
} from './openai.js';

describe('CONDENSE_QUESTION_SCHEMA', () => {
  test('is a strict json_schema named standalone_question with a single required query string', () => {
    expect(CONDENSE_QUESTION_SCHEMA.type).toBe('json_schema');
    expect(CONDENSE_QUESTION_SCHEMA.json_schema.name).toBe('standalone_question');
    expect(CONDENSE_QUESTION_SCHEMA.json_schema.strict).toBe(true);

    const schema = CONDENSE_QUESTION_SCHEMA.json_schema.schema as {
      required: string[];
      properties: { query: { type: string } };
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(['query']);
    expect(schema.properties.query.type).toBe('string');
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('prompts', () => {
  test('SCOPE_FALLBACK_MESSAGE is the exact warm scope-setting line', () => {
    expect(SCOPE_FALLBACK_MESSAGE).toBe(
      "I'm here to help you understand the learning topics. Ask me about one and I'll explain it.",
    );
  });

  test('DEVELOPER_MESSAGE grounds in retrieved content and is framed as a tutor', () => {
    expect(DEVELOPER_MESSAGE).toContain('Use ONLY the retrieved learning content');
    expect(DEVELOPER_MESSAGE).toContain('patient tutor for Glow');
  });
});

describe('condenseQuestion', () => {
  test('returns the raw query and skips the model call when there is no history', async () => {
    const result = await condenseQuestion({
      history: [],
      query: 'What is photosynthesis?',
      userId: 'u',
      logger: silentLogger,
    });

    expect(result).toEqual({ query: 'What is photosynthesis?' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('calls gpt-5-nano with the condense schema and returns the standalone query', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify({ query: 'why does Bob attend' }) },
        },
      ],
    });

    const result = await condenseQuestion({
      history: [
        { role: 'user', content: 'Tell me about Bob' },
        { role: 'assistant', content: 'Bob is a character.' },
      ],
      query: 'why is he there?',
      userId: 'u',
      logger: silentLogger,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5-nano',
      reasoning_effort: 'minimal',
      response_format: CONDENSE_QUESTION_SCHEMA,
      messages: [
        { role: 'developer', content: CONDENSE_QUESTION_MESSAGE },
        { role: 'user', content: 'Tell me about Bob' },
        { role: 'assistant', content: 'Bob is a character.' },
        { role: 'user', content: 'why is he there?' },
      ],
    });
    expect(result).toEqual({ query: 'why does Bob attend' });
  });

  test('includes only the last six history messages in the condense prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify({ query: 'q' }) },
        },
      ],
    });

    const history = Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    await condenseQuestion({ history, query: 'latest', userId: 'u', logger: silentLogger });

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5-nano',
      reasoning_effort: 'minimal',
      response_format: CONDENSE_QUESTION_SCHEMA,
      messages: [
        { role: 'developer', content: CONDENSE_QUESTION_MESSAGE },
        { role: 'user', content: 'm2' },
        { role: 'assistant', content: 'm3' },
        { role: 'user', content: 'm4' },
        { role: 'assistant', content: 'm5' },
        { role: 'user', content: 'm6' },
        { role: 'assistant', content: 'm7' },
        { role: 'user', content: 'latest' },
      ],
    });
  });

  test('returns a content-filtered marker and logs when the model flags the input', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'content_filter', message: { role: 'assistant', content: null } }],
    });

    const result = await condenseQuestion({
      history: [{ role: 'user', content: 'earlier' }],
      query: 'why is he there?',
      userId: 'u',
      logger: silentLogger,
    });

    expect(result).toEqual({ contentFiltered: true });
    expect(silentLogger.error).toHaveBeenCalledWith(
      { userId: 'u', finishReason: 'content_filter' },
      'Condensing finished with content_filter',
    );
  });

  test('falls back to the raw message and warns when the model call throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('nano down'));

    const result = await condenseQuestion({
      history: [{ role: 'user', content: 'earlier' }],
      query: 'why is he there?',
      userId: 'u',
      logger: silentLogger,
    });

    expect(result).toEqual({ query: 'why is he there?' });
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u' }),
      'Condensing failed, falling back to raw message',
    );
  });

  test('falls back to the raw message and warns when the model returns malformed content', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{ broken' } }],
    });

    const result = await condenseQuestion({
      history: [{ role: 'user', content: 'earlier' }],
      query: 'why is he there?',
      userId: 'u',
      logger: silentLogger,
    });

    expect(result).toEqual({ query: 'why is he there?' });
    expect(silentLogger.warn).toHaveBeenCalledWith(
      { userId: 'u' },
      'Condensing returned malformed output, falling back to raw message',
    );
  });
});

describe('createAnswerStream', () => {
  test('calls gpt-5-mini with developer prompt, history, context after history, then the question', async () => {
    mockCreate.mockResolvedValueOnce(streamChunks(['ok']));

    await collect(
      createAnswerStream(
        [
          { role: 'user', content: 'Tell me about Bob' },
          { role: 'assistant', content: 'Bob is a character.' },
        ],
        'why is he there?',
        [{ learning_unit_id: 'lu-1', content: 'Bob was invited.' }],
      ),
    );

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5-mini',
      reasoning_effort: 'low',
      verbosity: 'low',
      stream: true,
      messages: [
        { role: 'developer', content: DEVELOPER_MESSAGE },
        { role: 'user', content: 'Tell me about Bob' },
        { role: 'assistant', content: 'Bob is a character.' },
        { role: 'developer', content: '## Retrieved learning content\n\n- Bob was invited.' },
        { role: 'user', content: 'why is he there?' },
      ],
    });
  });

  test('yields text-delta parts then a finish part on stop', async () => {
    mockCreate.mockResolvedValueOnce(streamChunks(['Photo', 'synthesis']));

    const parts = await collect(
      createAnswerStream([], 'q', [{ learning_unit_id: 'lu', content: 'c' }]),
    );

    expect(parts).toEqual([
      { type: 'text-delta', text: 'Photo' },
      { type: 'text-delta', text: 'synthesis' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  test('normalizes content_filter to a content-filter finish part', async () => {
    mockCreate.mockResolvedValueOnce(streamChunks([], 'content_filter'));

    const parts = await collect(
      createAnswerStream([], 'q', [{ learning_unit_id: 'lu', content: 'c' }]),
    );

    expect(parts).toEqual([{ type: 'finish', finishReason: 'content-filter' }]);
  });

  test('yields a length finish part on truncation', async () => {
    mockCreate.mockResolvedValueOnce(streamChunks(['half'], 'length'));

    const parts = await collect(
      createAnswerStream([], 'q', [{ learning_unit_id: 'lu', content: 'c' }]),
    );

    expect(parts).toEqual([
      { type: 'text-delta', text: 'half' },
      { type: 'finish', finishReason: 'length' },
    ]);
  });

  test('yields an error part on delta.refusal', async () => {
    mockCreate.mockResolvedValueOnce(streamRefusal());

    const parts = await collect(
      createAnswerStream([], 'q', [{ learning_unit_id: 'lu', content: 'c' }]),
    );

    expect(parts).toEqual([{ type: 'error', error: 'I cannot answer that.' }]);
  });

  test('yields an error part when the create call throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('mini down'));

    const parts = await collect(
      createAnswerStream([], 'q', [{ learning_unit_id: 'lu', content: 'c' }]),
    );

    expect(parts).toEqual([{ type: 'error', error: expect.any(Error) }]);
  });

  test('yields a trailing error part when the stream ends without a finish part', async () => {
    mockCreate.mockResolvedValueOnce(streamNoFinish(['partial']));

    const parts = await collect(
      createAnswerStream([], 'q', [{ learning_unit_id: 'lu', content: 'c' }]),
    );

    expect(parts).toEqual([
      { type: 'text-delta', text: 'partial' },
      { type: 'error', error: expect.any(Error) },
    ]);
  });
});
