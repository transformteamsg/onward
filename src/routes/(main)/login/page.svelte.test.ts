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

  test('shows a general sign-in error for any other error code', () => {
    renderLogin('?error=oauth2_callback_failed');

    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Something went wrong while signing you in\. Please try again\.$/,
    );
  });
});
