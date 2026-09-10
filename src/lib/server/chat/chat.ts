import { db, Role } from '$lib/server/db.js';
import type { Logger } from '$lib/server/logger.js';
import {
  type ChatHistory,
  condenseQuestion,
  createAnswerStream,
  SCOPE_FALLBACK_MESSAGE,
} from '$lib/server/openai.js';
import { type LearningUnit, search } from '$lib/server/weaviate.js';

export interface ChatStreamOptions {
  userId: string;
  query: string;
  history: ChatHistory;
  logger: Logger;
  /**
   * Called exactly once when generation has stopped, on every path: graceful completion, error, and
   * client disconnect. Lets the caller free a resource it reserved for the turn before the stream
   * started, such as a concurrency slot. A throw is logged and swallowed, so the callback can never
   * break the response.
   */
  onSettled?: () => Promise<void>;
}

/**
 * Transport-agnostic chunks produced by the orchestration. The SSE encoder serializes `chunk` and
 * `error` as JSON data events and maps `done` to the `[DONE]` terminator.
 *
 * `done` is a domain signal, not a transport detail: it is emitted only on graceful completion
 * (answered or scope fallback) and never after an error, so the encoder must not synthesize `[DONE]`
 * on stream close.
 */
export type ChatChunk =
  | { type: 'chunk'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * Converts {@link ChatChunk}s into Server-Sent Events. `chunk`/`error` are serialized as
 * `data: {json}\n\n`; the `done` signal becomes the `data: [DONE]\n\n` terminator. `[DONE]` is
 * driven by an explicit `done` chunk rather than `flush()`, so it is sent only on graceful
 * completion and omitted after an error.
 */
export class ChatSseTransformStream extends TransformStream<ChatChunk, string> {
  constructor() {
    super({
      transform(chunk, controller) {
        controller.enqueue(
          chunk.type === 'done' ? 'data: [DONE]\n\n' : `data: ${JSON.stringify(chunk)}\n\n`,
        );
      },
    });
  }
}

/**
 * Persists a chat turn — the learner's message and the assistant's reply — to the learner's active
 * thread, creating the thread when none is active. Both messages are written in one transaction.
 *
 * @param userId - The learner's ID.
 * @param userQuery - The learner's message.
 * @param assistantContent - The assistant's reply.
 */
export async function saveTurn(
  userId: string,
  userQuery: string,
  assistantContent: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    let thread = await tx.thread.findFirst({
      where: { userId, isActive: true },
      select: { id: true },
    });
    if (!thread) {
      thread = await tx.thread.create({
        data: { userId, isActive: true },
        select: { id: true },
      });
    }
    await tx.message.createMany({
      data: [
        { threadId: thread.id, role: Role.USER, content: userQuery },
        { threadId: thread.id, role: Role.ASSISTANT, content: assistantContent },
      ],
    });
  });
}

// Pure orchestration: condense → search → gate → answer, yielding transport-agnostic chunks. DB-free
// (persistence lives in withOnFinish). Knows nothing about SSE or ReadableStream; createChatStream()
// drives it to completion in a detached task, so persistence runs even when the client disconnects.
async function* generateChunks(params: ChatStreamOptions): AsyncGenerator<ChatChunk> {
  const { userId, query, history, logger } = params;

  const condensed = await condenseQuestion({ history, query, userId, logger });
  if ('contentFiltered' in condensed) {
    yield { type: 'error', message: 'Content flagged' };
    return;
  }
  const searchQuery = condensed.query;

  let hits: LearningUnit[];
  try {
    hits = await search(searchQuery);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to search learning content');
    yield { type: 'error', message: 'Service error' };
    return;
  }

  // Relevance gate: maxVectorDistance prunes off-topic matches during retrieval, so an empty
  // result means nothing relevant was found — decline directly without calling the answer model.
  if (hits.length === 0) {
    yield { type: 'chunk', message: SCOPE_FALLBACK_MESSAGE };
    yield { type: 'done' };
    return;
  }

  for await (const part of createAnswerStream(history, query, hits)) {
    switch (part.type) {
      case 'text-delta':
        yield { type: 'chunk', message: part.text };
        break;
      case 'finish':
        if (part.finishReason === 'length') {
          yield { type: 'error', message: 'Max tokens reached' };
          return;
        }
        if (part.finishReason === 'content-filter') {
          yield { type: 'error', message: 'Content flagged' };
          return;
        }
        yield { type: 'done' }; // 'stop'
        return;
      case 'error':
        logger.error({ err: part.error, userId }, 'Answer stream failed');
        yield { type: 'error', message: 'Service error' };
        return;
    }
  }
}

// Mirrors the AI SDK's toUIMessageStream({ onFinish }): passes every chunk through untouched,
// accumulates the streamed text, and fires onFinish exactly once on `done` (graceful completion).
// Error paths emit `error`, not `done`, so they never persist.
export async function* withOnFinish(
  chunks: AsyncGenerator<ChatChunk>,
  onFinish: (text: string) => Promise<void>,
): AsyncGenerator<ChatChunk> {
  let text = '';
  for await (const chunk of chunks) {
    if (chunk.type === 'chunk') {
      text += chunk.message;
    }
    yield chunk;
    if (chunk.type === 'done') {
      await onFinish(text);
    }
  }
}

// Bridges the orchestration to a ReadableStream of chunks. The pump runs inside start(), so
// generation is driven independently of the consumer: a client disconnect makes enqueue throw (we
// swallow it) but never aborts the loop, so the turn is still persisted. There is deliberately no
// cancel handler: the consumer cannot abort the producer.
function createChatStream(params: ChatStreamOptions): ReadableStream<ChatChunk> {
  const stream = withOnFinish(generateChunks(params), async (text) => {
    try {
      await saveTurn(params.userId, params.query, text);
    } catch (err) {
      params.logger.error({ err, userId: params.userId }, 'Failed to persist messages');
    }
  });
  return new ReadableStream<ChatChunk>({
    async start(controller) {
      let settled = false;
      // Settles at most once, and — unlike waiting for the whole generator, whose `finally` sits
      // behind `withOnFinish`'s `await onFinish` — independently of whether persistence has
      // finished. A resource the caller reserved for this turn (a concurrency slot) should free the
      // moment generation reaches a terminal chunk, not stay held while the DB write is pending.
      const settleOnce = async () => {
        if (settled) {
          return;
        }
        settled = true;
        if (params.onSettled) {
          try {
            await params.onSettled();
          } catch (err) {
            params.logger.error({ err, userId: params.userId }, 'Failed to settle the chat stream');
          }
        }
      };
      // The close and the settle callback sit in `finally` too, so a throw from the generator still
      // closes the stream and still frees whatever the caller reserved for this turn.
      try {
        for await (const chunk of stream) {
          try {
            controller.enqueue(chunk);
          } catch {
            // Client disconnected; keep draining so persistence still runs.
          }
          if (chunk.type === 'done' || chunk.type === 'error') {
            // Enqueuing this chunk happens before `stream`'s next pull, which is what triggers
            // `withOnFinish`'s `await onFinish` on a `done` chunk -- so settling here can never be
            // delayed by persistence.
            await settleOnce();
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
        // Safety net for an exit path with no terminal chunk (e.g. the generator throws instead of
        // yielding `error`); the common paths above already settled by this point.
        await settleOnce();
      }
    },
  });
}

/**
 * Creates the streaming SSE `Response` for a chat turn: the orchestrated chunk stream encoded as
 * Server-Sent Events, then bytes.
 *
 * @param params.userId - The learner's ID.
 * @param params.query - The learner's latest message.
 * @param params.history - The prior turns of the conversation.
 * @param params.logger - The request-scoped logger.
 * @returns A `text/event-stream` response that streams the answer and persists the turn.
 */
export function createChatStreamResponse(params: ChatStreamOptions): Response {
  return new Response(
    createChatStream(params)
      .pipeThrough(new ChatSseTransformStream())
      .pipeThrough(new TextEncoderStream()),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    },
  );
}
