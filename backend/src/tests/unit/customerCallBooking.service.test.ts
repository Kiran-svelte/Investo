const mockFindActiveCallRequest = jest.fn();
const mockCancelCallRequest = jest.fn();
const mockRescheduleCallRequest = jest.fn();
const mockScheduleCallRequest = jest.fn();
const mockNotifyAgentCallChangeRequested = jest.fn().mockResolvedValue(undefined);
const mockSetAwaitingCallTime = jest.fn().mockResolvedValue(undefined);
const mockClearAwaitingCallTime = jest.fn().mockResolvedValue(undefined);
const mockBuildBuyerCallStatusReply = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    conversation: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../services/callRequest.service', () => ({
  buildBuyerCallStatusReply: (...args: unknown[]) => mockBuildBuyerCallStatusReply(...args),
  cancelCallRequest: (...args: unknown[]) => mockCancelCallRequest(...args),
  findActiveCallRequest: (...args: unknown[]) => mockFindActiveCallRequest(...args),
  formatBuyerCallReply: jest.fn((title: string) => title),
  notifyAgentCallChangeRequested: (...args: unknown[]) => mockNotifyAgentCallChangeRequested(...args),
  rescheduleCallRequest: (...args: unknown[]) => mockRescheduleCallRequest(...args),
  scheduleCallRequest: (...args: unknown[]) => mockScheduleCallRequest(...args),
}));

jest.mock('../../utils/conversationCallContext.util', () => ({
  clearConversationAwaitingCallTime: (...args: unknown[]) => mockClearAwaitingCallTime(...args),
  isConversationAwaitingCallTime: (commitments: unknown) =>
    Boolean(
      commitments
      && typeof commitments === 'object'
      && !Array.isArray(commitments)
      && (commitments as Record<string, unknown>).awaitingCallTime === true,
    ),
  setConversationAwaitingCallTime: (...args: unknown[]) => mockSetAwaitingCallTime(...args),
}));

import prisma from '../../config/prisma';
import { tryCommitCustomerCallBooking } from '../../services/customerCallBooking.service';

describe('customerCallBooking.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindActiveCallRequest.mockResolvedValue(null);
  });

  it('does not let buyers cancel a confirmed callback automatically', async () => {
    mockFindActiveCallRequest.mockResolvedValue({
      id: 'call-1',
      status: 'confirmed',
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
      agent_id: 'agent-1',
    });

    const result = await tryCommitCustomerCallBooking({
      companyId: 'company-1',
      customerMessage: 'cancel my call',
      lead: { id: 'lead-1', assignedAgentId: 'agent-1' },
    });

    expect(result.committed).toBe(true);
    expect(result.hasActiveCall).toBe(true);
    expect(mockCancelCallRequest).not.toHaveBeenCalled();
    expect(mockNotifyAgentCallChangeRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        callId: 'call-1',
        messageText: 'cancel my call',
      }),
    );
    expect(result.customerReply).toMatch(/already confirmed/i);
  });

  it('does not let buyers reschedule a confirmed callback automatically', async () => {
    mockFindActiveCallRequest.mockResolvedValue({
      id: 'call-1',
      status: 'confirmed',
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
      agent_id: 'agent-1',
    });

    const result = await tryCommitCustomerCallBooking({
      companyId: 'company-1',
      customerMessage: 'reschedule my call to tomorrow 3pm',
      lead: { id: 'lead-1', assignedAgentId: 'agent-1' },
    });

    expect(result.committed).toBe(true);
    expect(result.hasActiveCall).toBe(true);
    expect(mockRescheduleCallRequest).not.toHaveBeenCalled();
    expect(mockNotifyAgentCallChangeRequested).toHaveBeenCalled();
    expect(result.customerReply).toMatch(/already confirmed/i);
  });

  it('cancels pending callbacks and clears active-call buttons', async () => {
    mockFindActiveCallRequest.mockResolvedValue({
      id: 'call-1',
      status: 'pending_approval',
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
      agent_id: 'agent-1',
    });
    mockCancelCallRequest.mockResolvedValue({ success: true, call: { id: 'call-1' } });

    const result = await tryCommitCustomerCallBooking({
      companyId: 'company-1',
      customerMessage: 'cancel my call',
      lead: { id: 'lead-1', assignedAgentId: 'agent-1' },
    });

    expect(result.committed).toBe(true);
    expect(result.hasActiveCall).toBe(false);
    expect(mockCancelCallRequest).toHaveBeenCalledWith({ companyId: 'company-1', callId: 'call-1' });
  });

  it('sets awaitingCallTime when scheduleCallRequest fails', async () => {
    mockScheduleCallRequest.mockResolvedValue({ success: false, error: 'no_agent' });

    const result = await tryCommitCustomerCallBooking({
      companyId: 'company-1',
      customerMessage: 'call me tomorrow 3pm',
      conversationId: 'conv-1',
      lead: { id: 'lead-1', assignedAgentId: 'agent-1' },
    });

    expect(result.committed).toBe(true);
    expect(result.hasActiveCall).toBe(false);
    expect(mockSetAwaitingCallTime).toHaveBeenCalledWith('conv-1');
    expect(result.customerReply).toMatch(/share a good time/i);
  });

  it('books bare time replies when awaitingCallTime is set', async () => {
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      commitments: { awaitingCallTime: true },
    });
    mockScheduleCallRequest.mockResolvedValue({
      success: true,
      call: { id: 'call-2', agent_id: 'agent-1', status: 'pending_approval' },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: 'Agent' });

    const result = await tryCommitCustomerCallBooking({
      companyId: 'company-1',
      customerMessage: '9 pm today',
      conversationId: 'conv-1',
      lead: { id: 'lead-1', assignedAgentId: 'agent-1' },
    });

    expect(result.committed).toBe(true);
    expect(result.hasActiveCall).toBe(true);
    expect(mockScheduleCallRequest).toHaveBeenCalled();
    expect(mockClearAwaitingCallTime).toHaveBeenCalledWith('conv-1');
  });

  it('returns status reply with hasActiveCall when a callback exists', async () => {
    mockFindActiveCallRequest.mockResolvedValue({
      id: 'call-1',
      status: 'pending_approval',
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
      agent_id: 'agent-1',
    });
    mockBuildBuyerCallStatusReply.mockResolvedValue('*YOUR CALLBACK*\nWhen: tomorrow');

    const result = await tryCommitCustomerCallBooking({
      companyId: 'company-1',
      customerMessage: 'when is my call?',
      lead: { id: 'lead-1', assignedAgentId: 'agent-1' },
    });

    expect(result.committed).toBe(true);
    expect(result.hasActiveCall).toBe(true);
    expect(result.customerReply).toContain('YOUR CALLBACK');
  });
});
