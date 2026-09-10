import type { LayoutServerLoad } from './$types';

/**
 * Supplies the session CSRF token to every protected admin page. The sidebar sign-out form submits
 * it, and the CSRF cookie is `httpOnly`, so the token has to reach the client as page data.
 */
export const load: LayoutServerLoad = async (event) => {
  return {
    csrfToken: event.locals.session.csrfToken(),
  };
};
