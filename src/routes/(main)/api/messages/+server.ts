import { json, type RequestHandler } from '@sveltejs/kit';

import { learnerAuth } from '$lib/server/auth';
import { CHAT_RATE_LIMIT_NAMESPACE, chatLimits, createChatStreamResponse } from '$lib/server/chat';
import { db, type MessageFindManyArgs, type MessageGetPayload } from '$lib/server/db.js';
import { consumeFixedWindow, type RateLimitDecision } from '$lib/server/ratelimit';
import { valkey } from '$lib/server/valkey.js';

import type { JSONObject } from '../types';

export const GET: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'api_get_messages' });

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return json(null, { status: 401 });
  }

  try {
    const messages = await db.message.findMany({
      where: {
        thread: {
          userId: user.id,
          isActive: true,
        },
      },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    return json({ messages }, { status: 200 });
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to retrieve messages');
    return json(null, { status: 500 });
  }
};

export const POST: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'api_create_message' });

  if (event.request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return json(null, { status: 415 });
  }

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return json(null, { status: 401 });
  }

  const csrfToken = event.request.headers.get('x-csrf-token');
  if (!csrfToken || typeof csrfToken !== 'string') {
    logger.warn('CSRF token is missing');
    return json(null, { status: 400 });
  }

  const isValidCSRFToken = await learnerAuth.validateCSRFToken(event, csrfToken);
  if (!isValidCSRFToken) {
    logger.warn('CSRF token is invalid');
    return json(null, { status: 400 });
  }

  // Count the request before parsing the body, so a flood is rejected on the cheapest possible path.
  let decision: RateLimitDecision;
  try {
    decision = await consumeFixedWindow(valkey, {
      namespace: CHAT_RATE_LIMIT_NAMESPACE,
      identifier: user.id,
      limit: chatLimits.maxRequests,
      windowSeconds: chatLimits.windowSeconds,
    });
  } catch (err) {
    // Fail closed: the limiter guards third-party spend, so an unreadable counter must not become an
    // unlimited allowance. Valkey already holds the session, so a learner cannot reach here with it
    // down anyway.
    logger.error({ err, userId: user.id }, 'Failed to apply the request rate limit');
    return json(null, { status: 503 });
  }

  if (!decision.allowed) {
    logger.warn(
      { userId: user.id, retryAfterSeconds: decision.retryAfterSeconds },
      'Request rate limit exceeded',
    );
    return json(null, {
      status: 429,
      headers: { 'Retry-After': String(decision.retryAfterSeconds) },
    });
  }

  let params: JSONObject;
  try {
    params = await event.request.json();
    if (
      !params ||
      typeof params !== 'object' ||
      !('query' in params) ||
      typeof params['query'] !== 'string' ||
      params['query'].trim().length === 0
    ) {
      return json(null, { status: 422 });
    }
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to parse request body');
    return json(null, { status: 400 });
  }

  const query = params['query'];

  const messagesArgs = {
    select: { role: true, content: true },
    where: { thread: { userId: user.id, isActive: true } },
    orderBy: { createdAt: 'asc' },
  } satisfies MessageFindManyArgs;

  let history: MessageGetPayload<typeof messagesArgs>[];
  try {
    history = await db.message.findMany(messagesArgs);
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to get chat history');
    return json(null, { status: 500 });
  }

  return createChatStreamResponse({
    userId: user.id,
    query,
    history: history.map((m) => ({
      role: m.role.toLowerCase() as 'user' | 'assistant',
      content: m.content,
    })),
    logger,
  });
};

export const DELETE: RequestHandler = async (event) => {
  const logger = event.locals.logger.child({ handler: 'api_delete_messages' });

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    return json(null, { status: 401 });
  }

  try {
    await db.thread.updateMany({
      where: { userId: user.id, isActive: true },
      data: { isActive: false },
    });

    return new Response(null, { status: 204 });
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to update threads');
    return json(null, { status: 500 });
  }
};
