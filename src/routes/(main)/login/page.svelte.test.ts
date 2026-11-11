import { render, screen } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';

import { HOME_PATH } from '$lib/helpers/index.js';

import LoginPage from './+page.svelte';

const { mockPage } = vi.hoisted(() => ({
  mockPage: { url: new URL('http://localhost/login') },
}));

vi.mock('$app/state', () => ({ page: mockPage }));
// `$lib/helpers` re-exports the analytics module, which reads the public env at import time.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

function renderLogin(search = '') {
  mockPage.url = new URL(`http://localhost/login${search}`);
  return render(LoginPage);
}

describe('login page', () => {
  test('links the Edupass button to /auth/edupass with the return_to page', () => {
    renderLogin('?return_to=%2Funit%2F42');

    expect(screen.getByRole('link', { name: 'Sign in with Edupass' })).toHaveAttribute(
      'href',
      '/auth/edupass?return_to=%2Funit%2F42',
    );
  });

  test('links the Edupass button back to the home page when no return_to is given', () => {
    renderLogin();

    expect(screen.getByRole('link', { name: 'Sign in with Edupass' })).toHaveAttribute(
      'href',
      `/auth/edupass?return_to=${encodeURIComponent(HOME_PATH)}`,
    );
  });

  test('explains that the Edupass account has no email address', () => {
    renderLogin('?error=edupass_no_email');

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Your Edupass account has no email address, so you can't sign in to Glow. Please contact your school's Edupass administrator.",
    );
  });

  test('asks the learner to try again when Edupass is busy', () => {
    renderLogin('?error=edupass_unavailable');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Edupass is busy right now. Please wait a moment, then try again.',
    );
  });

  test('shows a general sign-in error for any other error code', () => {
    renderLogin('?error=oauth2_callback_failed');

    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Something went wrong while signing you in\. Please try again\.$/,
    );
  });
});
