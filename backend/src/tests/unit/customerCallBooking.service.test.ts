const mockFindActiveCallRequest = jest.fn();
const mockCancelCallRequest = jest.fn();
const mockRescheduleCallRequest = jest.fn();
const mockScheduleCallRequest = jest.fn();
const mockNotifyAgentCallChangeRequested = jest.fn().mockResolvedValue(undefined);

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    conversation: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../services/callRequest.service', () => ({
  buildBuyerCallStatusReply: jest.fn(),
  cancelCallRequest: (...args: unknown[]) => mockCancelCallRequest(...args),
  findActiveCallRequest: (...args: unknown[]) => mockFindActiveCallRequest(...args),
  formatBuyerCallReply: jest.fn((title: string) => title),
  notifyAgentCallChangeRequested: (...args: unknown[]) => mockNotifyAgentCallChangeRequested(...args),
  rescheduleCallRequest: (...args: unknown[]) => mockRescheduleCallRequest(...args),
  scheduleCallRequest: (...args: unknown[]) => mockScheduleCallRequest(...args),
}));

import { tryCommitCustomerCallBooking } from '../../services/customerCallBooking.service';

describe('customerCallBooking.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(mockRescheduleCallRequest).not.toHaveBeenCalled();
    expect(mockNotifyAgentCallChangeRequested).toHaveBeenCalled();
    expect(result.customerReply).toMatch(/already confirmed/i);
  });
});
