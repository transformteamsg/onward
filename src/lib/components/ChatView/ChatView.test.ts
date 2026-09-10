import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ChatView } from './index.js';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: {
    data: {
      username: 'TestUser',
      csrfToken: 'test-token',
    },
  },
}));

vi.mock('$env/dynamic/public', () => ({
  env: {
    PUBLIC_GOOGLE_ANALYTICS_ID: 'test-ga-id',
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Must be a function expression, not an arrow: the component calls
// `new IntersectionObserver(…)`, and Vitest 4 constructs the mock implementation directly.
global.IntersectionObserver = vi.fn().mockImplementation(function () {
  return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  };
});

Element.prototype.scrollTo = vi.fn();

describe('ChatView', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [] }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  test('does not render when isopen is false', () => {
    render(ChatView, { props: { isopen: false, onclose: vi.fn() } });
    expect(screen.queryByText('Ask AI')).not.toBeInTheDocument();
  });

  test('renders when isopen is true', async () => {
    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });
    expect(await screen.findByText('Ask AI')).toBeInTheDocument();
  });

  test('displays greeting with username', async () => {
    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });
    expect(await screen.findByText(/Hi TestUser!/)).toBeInTheDocument();
  });

  test('send button is disabled when textarea is empty', async () => {
    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });
    await screen.findByText('Ask AI');

    const buttons = screen.getAllByRole('button');
    const sendButton = buttons[buttons.length - 1];
    expect(sendButton).toBeDisabled();
  });

  test('calls onclose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onclose = vi.fn();
    render(ChatView, { props: { isopen: true, onclose } });
    await screen.findByText('Ask AI');

    const buttons = screen.getAllByRole('button');
    const closeButton = buttons[0];
    await user.click(closeButton);
    expect(onclose).toHaveBeenCalled();
  });

  test('does not show clear button when no messages', async () => {
    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });
    await screen.findByText('Ask AI');
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  test('sends message when user types and clicks send', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ messages: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"type":"string","message":"Hello"}\n\n'),
            );
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
      });

    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });
    await screen.findByText('Ask AI');

    const textarea = screen.getByPlaceholderText('Ask questions about a topic');
    await user.type(textarea, 'Test question');

    const buttons = screen.getAllByRole('button');
    const sendButton = buttons[buttons.length - 1];
    await user.click(sendButton);

    expect(await screen.findByText('Test question')).toBeInTheDocument();
  });

  test('sends message on Enter key press', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ messages: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
      });

    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });
    await screen.findByText('Ask AI');

    const textarea = screen.getByPlaceholderText('Ask questions about a topic');
    await user.type(textarea, 'Test question');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Test question')).toBeInTheDocument();
  });

  test('clears messages when clear button is clicked', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: [{ role: 'USER', content: 'Hello' }] }),
      })
      .mockResolvedValueOnce({ ok: true });

    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });

    await screen.findByText('Hello');

    const clearButton = screen.getByText('Clear');
    await user.click(clearButton);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/messages',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('shows error message on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  test('redirects to login on 401 response', async () => {
    const { goto } = await import('$app/navigation');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    render(ChatView, { props: { isopen: true, onclose: vi.fn() } });

    await screen.findByText('Ask AI');
    await new Promise((r) => setTimeout(r, 100));

    expect(goto).toHaveBeenCalledWith('/login');
  });
});
