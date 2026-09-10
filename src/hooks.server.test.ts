import { type Handle, isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mainHandle, adminHandle } = vi.hoisted(() => ({
  mainHandle: vi.fn(),
  adminHandle: vi.fn(),
}));

// The root hook reaches the group hooks through `import.meta.glob`, which Vite
// compiles to a dynamic import per matched file. Mocking those two specifiers
// therefore intercepts the dispatch without loading the real auth stack.
vi.mock('./routes/(main)/hooks.server.ts', () => ({ handle: mainHandle }));
vi.mock('./routes/admin/hooks.server.ts', () => ({ handle: adminHandle }));

import { handle } from './hooks.server.js';

type HookArgs = Parameters<Handle>[0];

const buildEvent = (pathname: string) =>
  ({ url: new URL(`http://localhost${pathname}`) }) as unknown as HookArgs['event'];

const resolve = vi.fn(async () => new Response('resolved')) as unknown as HookArgs['resolve'];

const dispatch = (pathname: string) =>
  Promise.resolve(handle({ event: buildEvent(pathname), resolve }));

beforeEach(() => {
  vi.clearAllMocks();
  mainHandle.mockResolvedValue(new Response('main'));
  adminHandle.mockResolvedValue(new Response('admin'));
});

describe('root hook realm dispatch', () => {
  test('dispatches a percent-encoded admin path to the admin hook', async () => {
    // `%61` is `a`. SvelteKit matches routes on the decoded path, so this request
    // resolves to an admin route and must pass through the admin guard.
    await dispatch('/%61dmin/unit/new');

    expect(adminHandle).toHaveBeenCalledTimes(1);
    expect(mainHandle).not.toHaveBeenCalled();
  });

  test('dispatches a plain admin path to the admin hook', async () => {
    await dispatch('/admin/unit/new');

    expect(adminHandle).toHaveBeenCalledTimes(1);
    expect(mainHandle).not.toHaveBeenCalled();
  });

  test('dispatches the admin root to the admin hook', async () => {
    await dispatch('/admin');

    expect(adminHandle).toHaveBeenCalledTimes(1);
    expect(mainHandle).not.toHaveBeenCalled();
  });

  test('dispatches a learner path to the (main) hook', async () => {
    await dispatch('/home');

    expect(mainHandle).toHaveBeenCalledTimes(1);
    expect(adminHandle).not.toHaveBeenCalled();
  });

  test('does not decode twice, so an encoded percent sign stays a learner path', async () => {
    // `/%2561dmin` decodes to `/%61dmin`, not to `/admin`, so SvelteKit matches a
    // (main) route. Double decoding here would send it to the wrong realm.
    await dispatch('/%2561dmin');

    expect(mainHandle).toHaveBeenCalledTimes(1);
    expect(adminHandle).not.toHaveBeenCalled();
  });

  test('treats an encoded slash as one segment, so it stays a learner path', async () => {
    await dispatch('/%2Fadmin');

    expect(mainHandle).toHaveBeenCalledTimes(1);
    expect(adminHandle).not.toHaveBeenCalled();
  });

  test('dispatches a path that only starts with the admin prefix to the (main) hook', async () => {
    // `/administrator` matches a (main) route, so the (main) hook owns it.
    await dispatch('/administrator');

    expect(mainHandle).toHaveBeenCalledTimes(1);
    expect(adminHandle).not.toHaveBeenCalled();
  });

  test('rejects a malformed percent sequence with 400 and dispatches to no hook', async () => {
    const error = await dispatch('/%ZZ').then(
      () => null,
      (err: unknown) => err,
    );

    expect(isHttpError(error)).toBe(true);
    expect(isHttpError(error) && error.status).toBe(400);
    expect(mainHandle).not.toHaveBeenCalled();
    expect(adminHandle).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  test('rejects a truncated percent sequence with 400', async () => {
    const error = await dispatch('/%').then(
      () => null,
      (err: unknown) => err,
    );

    expect(isHttpError(error) && error.status).toBe(400);
    expect(mainHandle).not.toHaveBeenCalled();
    expect(adminHandle).not.toHaveBeenCalled();
  });
});
