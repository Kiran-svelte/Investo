/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationsPage from './ConversationsPage';

const { getMock, patchMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      role: 'company_admin',
      company_id: 'company-1',
      name: 'Agent One',
    },
  }),
}));

vi.mock('../../context/SocketContext', () => ({
  SOCKET_EVENTS: {
    CONVERSATION_UPDATED: 'conversation:updated',
  },
  useSocketEvent: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../services/api', () => ({
  default: {
    get: getMock,
    patch: patchMock,
    post: postMock,
  },
}));

afterEach(() => {
  cleanup();
});

describe('ConversationsPage composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getMock.mockImplementation((url: string) => {
      if (url.startsWith('/conversations?')) {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'conv-1',
                lead_id: 'lead-1',
                customer_name: 'Asha',
                customer_phone: '+919876543210',
                status: 'agent_active',
                language: 'en',
                ai_enabled: true,
                updated_at: '2026-04-09T10:00:00.000Z',
                last_message: {
                  content: 'Previous message',
                  sender_type: 'customer',
                  created_at: '2026-04-09T09:55:00.000Z',
                },
              },
            ],
          },
        });
      }

      if (url === '/conversations/conv-1') {
        return Promise.resolve({
          data: {
            data: {
              messages: [
                {
                  id: 'msg-existing-1',
                  sender_type: 'customer',
                  content: 'Hello agent',
                  language: 'en',
                  created_at: '2026-04-09T09:59:00.000Z',
                },
              ],
            },
          },
        });
      }

      return Promise.resolve({ data: { data: [] } });
    });

    postMock.mockResolvedValue({
      data: {
        data: {
          id: 'msg-new-1',
          sender_type: 'agent',
          content: 'Outbound message',
          language: 'en',
          created_at: '2026-04-09T10:01:00.000Z',
        },
        conversation_status: 'agent_active',
      },
    });
  });

  it('renders mode-specific inputs and sends mode payloads', async () => {
    const user = userEvent.setup();

    render(<ConversationsPage />);

    await screen.findByText('Asha');
    await user.click(screen.getByText('Asha'));

    await screen.findByPlaceholderText('Type a message');
    await user.type(screen.getByPlaceholderText('Type a message'), 'Agent text reply');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/conversations/conv-1/messages', {
        mode: 'text',
        text: 'Agent text reply',
      });
    });

    await user.click(screen.getByRole('button', { name: 'Document' }));
    await user.type(screen.getByPlaceholderText('Document URL (https://...)'), 'https://cdn.example.com/brochure.pdf');
    await user.type(screen.getByPlaceholderText('Filename (optional)'), 'Brochure.pdf');
    await user.type(screen.getByPlaceholderText('Caption (optional)'), 'Latest brochure');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/conversations/conv-1/messages', {
        mode: 'document',
        document_url: 'https://cdn.example.com/brochure.pdf',
        filename: 'Brochure.pdf',
        caption: 'Latest brochure',
      });
    });

    await user.click(screen.getByRole('button', { name: 'Quick Reply' }));
    await user.type(screen.getByPlaceholderText('Quick-reply message body'), 'Pick a slot');
    await user.type(screen.getByPlaceholderText('Button 1 ID'), 'slot_morning');
    await user.type(screen.getByPlaceholderText('Button 1 Title'), 'Morning');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/conversations/conv-1/messages', {
        mode: 'quick_reply',
        body_text: 'Pick a slot',
        header_text: undefined,
        footer_text: undefined,
        buttons: [{ id: 'slot_morning', title: 'Morning' }],
      });
    });
  });

  it('locks send button while request is in-flight to prevent duplicate sends', async () => {
    const user = userEvent.setup();

    let resolvePost: (value: any) => void = () => {};
    postMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePost = resolve;
    }));

    render(<ConversationsPage />);

    await screen.findByText('Asha');
    await user.click(screen.getByText('Asha'));

    await user.type(screen.getByPlaceholderText('Type a message'), 'Single click only');
    const sendButton = screen.getByRole('button', { name: 'Send' });

    await user.click(sendButton);
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Sending...' }));
    expect(postMock).toHaveBeenCalledTimes(1);

    resolvePost({
      data: {
        data: {
          id: 'msg-lock-1',
          sender_type: 'agent',
          content: 'Single click only',
          language: 'en',
          created_at: '2026-04-09T10:05:00.000Z',
        },
        conversation_status: 'agent_active',
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });
  });

  it('shows API errors from send failures', async () => {
    const user = userEvent.setup();

    postMock.mockRejectedValueOnce({
      response: {
        data: {
          error: 'Failed to send via WhatsApp',
        },
      },
    });

    render(<ConversationsPage />);

    await screen.findByText('Asha');
    await user.click(screen.getByText('Asha'));

    await user.type(screen.getByPlaceholderText('Type a message'), 'Will fail');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Failed to send via WhatsApp')).toBeInTheDocument();
  });
});
