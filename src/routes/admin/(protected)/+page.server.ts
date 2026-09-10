import { error, redirect } from '@sveltejs/kit';

import { db, type LearningUnitFindManyArgs, type LearningUnitGetPayload } from '$lib/server/db.js';

import type { PageServerLoad } from './$types';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
/** Keeps `skip` inside the 32-bit integer range that Prisma accepts. */
const MAX_PAGE = 1_000_000;

/**
 * Reads a positive integer from a query parameter.
 *
 * A missing value, a non-numeric value, or a value below 1 gives `fallback`. A
 * value above `max` is clamped to `max`. A fractional value is rounded down.
 */
const readPositiveInt = (value: string | null, fallback: number, max: number): number => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
};

export const load: PageServerLoad = async (event) => {
  const logger = event.locals.logger.child({
    userID: event.locals.session.user!.id,
    handler: 'page_load_admin',
  });

  const { user } = event.locals.session;
  if (!user) {
    logger.warn('User not authenticated');
    throw redirect(303, '/admin');
  }

  const page = readPositiveInt(event.url.searchParams.get('page'), 1, MAX_PAGE);
  const pageSize = readPositiveInt(
    event.url.searchParams.get('pageSize'),
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );
  const skip = (page - 1) * pageSize;

  const learningUnitArgs = {
    select: {
      id: true,
      title: true,
      status: true,
      createdBy: true,
      createdAt: true,
      isRecommended: true,
      isRequired: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    skip,
    take: pageSize,
  } satisfies LearningUnitFindManyArgs;

  let learningUnits: LearningUnitGetPayload<typeof learningUnitArgs>[];
  let totalCount: number;
  try {
    [learningUnits, totalCount] = await Promise.all([
      db.learningUnit.findMany(learningUnitArgs),
      db.learningUnit.count(),
    ]);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch learning units');
    throw error(500, 'Internal Server Error');
  }

  return {
    learningUnits,
    totalCount,
    currentPage: page,
    pageSize,
  };
};
