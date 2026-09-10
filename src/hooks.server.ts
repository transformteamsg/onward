import { error, type Handle } from '@sveltejs/kit';

import { decodeRoutePathname } from '$lib/server/request-path.js';

const route_specific_hooks = import.meta.glob('./routes/**/hooks.server.ts') as Record<
  string,
  () => Promise<{ handle: Handle }>
>;

export const handle: Handle = async function handle({ event, resolve }) {
  // Pick the realm from the decoded pathname, because that is the value SvelteKit
  // matches routes with. `event.url.pathname` keeps its percent-encoding, so
  // dispatching on it would send `/%61dmin/unit/new` to the learner hook while
  // SvelteKit still resolves it to an admin route, and the admin guard would never
  // run.
  const routePathname = decodeRoutePathname(event.url.pathname);

  if (routePathname === null) {
    // A malformed percent-sequence matches no route in SvelteKit, so there is no
    // realm to pick and no route to serve. Reject the request rather than guess a
    // realm for it.
    error(400, 'Bad Request');
  }

  // Test the route group boundary, not just the prefix. `startsWith('/admin')` would
  // also claim `/administrator`, which SvelteKit resolves to a `(main)` route.
  const hookDir =
    routePathname === '/admin' || routePathname.startsWith('/admin/') ? '/admin' : '/(main)';
  const importer = route_specific_hooks['./routes' + hookDir + '/hooks.server.ts'];

  if (importer) {
    const module = await importer();
    if (module.handle) {
      return module.handle({ event, resolve });
    }
  }

  return resolve(event);
};
