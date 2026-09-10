import { beforeEach, describe, expect, test, vi } from 'vitest';

import { load } from './+page.server.js';

const { mockUnitFindMany, mockUnitCount } = vi.hoisted(() => ({
  mockUnitFindMany: vi.fn(),
  mockUnitCount: vi.fn(),
}));

vi.mock('$lib/server/db.js', () => ({
  db: {
    learningUnit: { findMany: mockUnitFindMany, count: mockUnitCount },
  },
}));

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};
silentLogger.child.mockReturnValue(silentLogger);

const buildEvent = (url: string) =>
  ({
    locals: { logger: silentLogger, session: { user: { id: 'admin-1' } } },
    url: new URL(url),
  }) as unknown as Parameters<typeof load>[0];

beforeEach(() => {
  vi.clearAllMocks();
  silentLogger.child.mockReturnValue(silentLogger);
  mockUnitFindMany.mockResolvedValue([]);
  mockUnitCount.mockResolvedValue(0);
});

describe('admin learning unit list load', () => {
  test('uses the default page and page size', async () => {
    const data = await load(buildEvent('http://localhost/admin'));

    expect(mockUnitFindMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 10 });
    expect(data).toMatchObject({ currentPage: 1, pageSize: 10 });
  });

  test('honours an in-range page and page size', async () => {
    const data = await load(buildEvent('http://localhost/admin?page=3&pageSize=25'));

    expect(mockUnitFindMany.mock.calls[0][0]).toMatchObject({ skip: 50, take: 25 });
    expect(data).toMatchObject({ currentPage: 3, pageSize: 25 });
  });

  test('clamps a page size above the maximum', async () => {
    const data = await load(buildEvent('http://localhost/admin?pageSize=100000000'));

    expect(mockUnitFindMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
    expect(data).toMatchObject({ pageSize: 100 });
  });

  test('replaces a page size below one with the default', async () => {
    await load(buildEvent('http://localhost/admin?pageSize=0'));
    await load(buildEvent('http://localhost/admin?pageSize=-5'));

    expect(mockUnitFindMany.mock.calls[0][0]).toMatchObject({ take: 10 });
    expect(mockUnitFindMany.mock.calls[1][0]).toMatchObject({ take: 10 });
  });

  test('rounds a fractional page size down to an integer', async () => {
    await load(buildEvent('http://localhost/admin?pageSize=12.9'));

    expect(mockUnitFindMany.mock.calls[0][0]).toMatchObject({ take: 12 });
  });

  test('replaces a non-numeric page size with the default', async () => {
    await load(buildEvent('http://localhost/admin?pageSize=all'));

    expect(mockUnitFindMany.mock.calls[0][0]).toMatchObject({ take: 10 });
  });

  test('keeps skip at zero for a page below one', async () => {
    await load(buildEvent('http://localhost/admin?page=0'));
    await load(buildEvent('http://localhost/admin?page=-5'));

    expect(mockUnitFindMany.mock.calls[0][0]).toMatchObject({ skip: 0 });
    expect(mockUnitFindMany.mock.calls[1][0]).toMatchObject({ skip: 0 });
  });

  test('clamps a page above the maximum so skip stays a 32-bit integer', async () => {
    await load(buildEvent('http://localhost/admin?page=1e12&pageSize=100'));

    const args = mockUnitFindMany.mock.calls[0][0];
    expect(args.skip).toBe(99_999_900);
    expect(args.skip).toBeLessThanOrEqual(2_147_483_647);
  });
});
