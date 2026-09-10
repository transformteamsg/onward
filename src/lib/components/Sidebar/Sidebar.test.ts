import { BookOpen, Home, Settings } from '@lucide/svelte';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';

import { Sidebar } from './index.js';

describe('Sidebar', () => {
  const mockNavItems = [
    { href: '/admin', label: 'Dashboard', icon: Home },
    { href: '/admin/settings', label: 'Settings', icon: Settings },
    { href: '/admin/content', label: 'Content', icon: BookOpen },
  ];

  test('renders sidebar title', () => {
    render(Sidebar, {
      props: {
        title: 'Test Admin',
        currentPath: '/admin',
        navItems: mockNavItems,
        csrfToken: 'csrf-token',
      },
    });
    expect(screen.getByText('Test Admin')).toBeInTheDocument();
  });

  test('renders all navigation items', () => {
    render(Sidebar, {
      props: {
        title: 'Test Admin',
        currentPath: '/admin',
        navItems: mockNavItems,
        csrfToken: 'csrf-token',
      },
    });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  test('highlights active navigation item', () => {
    const { container } = render(Sidebar, {
      props: {
        title: 'Test Admin',
        currentPath: '/admin/settings',
        navItems: mockNavItems,
        csrfToken: 'csrf-token',
      },
    });

    const links = container.querySelectorAll('a');
    const settingsLink = Array.from(links).find((link) => link.textContent?.includes('Settings'));

    expect(settingsLink).toHaveClass('bg-slate-100');
  });

  test('does not highlight inactive navigation items', () => {
    const { container } = render(Sidebar, {
      props: {
        title: 'Test Admin',
        currentPath: '/admin/settings',
        navItems: mockNavItems,
        csrfToken: 'csrf-token',
      },
    });

    const links = container.querySelectorAll('a');
    const dashboardLink = Array.from(links).find((link) => link.textContent?.includes('Dashboard'));

    expect(dashboardLink).not.toHaveClass('bg-slate-100');
  });

  test('renders logout button', () => {
    render(Sidebar, {
      props: {
        title: 'Test Admin',
        currentPath: '/admin',
        navItems: mockNavItems,
        csrfToken: 'csrf-token',
      },
    });
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  // Sign-out changes state, so it must be a POST that carries the CSRF token. A logout link would
  // let a cross-site top-level navigation end the session.
  test('logout is a POST form to /admin/logout that submits the CSRF token', () => {
    const { container } = render(Sidebar, {
      props: {
        title: 'Test Admin',
        currentPath: '/admin',
        navItems: mockNavItems,
        csrfToken: 'csrf-token',
      },
    });

    const logoutForm = screen.getByText('Logout').closest('form');
    expect(logoutForm).toHaveAttribute('method', 'POST');
    expect(logoutForm).toHaveAttribute('action', '/admin/logout');
    expect(screen.getByText('Logout').closest('a')).toBeNull();

    const csrfInput = logoutForm?.querySelector('input[name="csrfToken"]');
    expect(csrfInput).toHaveAttribute('type', 'hidden');
    expect(csrfInput).toHaveValue('csrf-token');
    expect(container.querySelector('a[href="/admin/logout"]')).toBeNull();
  });

  test('navigation items have correct hrefs', () => {
    render(Sidebar, {
      props: {
        title: 'Test Admin',
        currentPath: '/admin',
        navItems: mockNavItems,
        csrfToken: 'csrf-token',
      },
    });

    const dashboardLink = screen.getByText('Dashboard').closest('a');
    const settingsLink = screen.getByText('Settings').closest('a');
    const contentLink = screen.getByText('Content').closest('a');

    expect(dashboardLink).toHaveAttribute('href', '/admin');
    expect(settingsLink).toHaveAttribute('href', '/admin/settings');
    expect(contentLink).toHaveAttribute('href', '/admin/content');
  });

  test('applies hover styles to navigation items', () => {
    const { container } = render(Sidebar, {
      props: {
        title: 'Test Admin',
        currentPath: '/admin',
        navItems: mockNavItems,
        csrfToken: 'csrf-token',
      },
    });

    const links = container.querySelectorAll('nav a');
    links.forEach((link) => {
      expect(link).toHaveClass('hover:bg-slate-100');
    });
  });
});
