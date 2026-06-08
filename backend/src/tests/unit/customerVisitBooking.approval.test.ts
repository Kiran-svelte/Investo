const mockFindPendingVisitApprovalForLead = jest.fn();
const mockCancelPendingVisitApprovalForBuyer = jest.fn();
const mockReschedulePendingVisitApprovalForBuyer = jest.fn();
const mockNotifyAgentVisitChangeRequested = jest.fn().mockResolvedValue(undefined);
const mockApplyVisitMutationFromChat = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    visit: { findFirst: jest.fn() },
    conversation: { findUnique: jest.fn() },
  },
}));

jest.mock('../../services/visitPendingApproval.service', () => ({
  cancelPendingVisitApprovalForBuyer: (...args: unknown[]) => mockCancelPendingVisitApprovalForBuyer(...args),
  createVisitApprovalRequest: jest.fn(),
  findPendingVisitApprovalForLead: (...args: unknown[]) => mockFindPendingVisitApprovalForLead(...args),
  notifyAgentVisitChangeRequested: (...args: unknown[]) => mockNotifyAgentVisitChangeRequested(...args),
  reschedulePendingVisitApprovalForBuyer: (...args: unknown[]) => mockReschedulePendingVisitApprovalForBuyer(...args),
}));

jest.mock('../../services/visitMutationFromChat.service', () => ({
  applyVisitMutationFromChat: (...args: unknown[]) => mockApplyVisitMutationFromChat(...args),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../config/prisma';
import { tryCustomerVisitCancelReschedule } from '../../services/customerVisitBooking.service';

const baseInput = {
  companyId: 'company-1',
  lead: { id: 'lead-1', assignedAgentId: 'agent-1', customerName: 'Ravi', status: 'contacted' },
  conversation: {
    id: 'conversation-1',
    selectedPropertyId: 'property-1',
    proposedVisitTime: null,
    recommendedPropertyIds: [],
  },
  customerPhone: '+919999988888',
  recentCustomerMessages: [],
};

describe('customerVisitBooking approval mutation rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
  });

  it('lets buyers cancel a pending visit approval request', async () => {
    mockFindPendingVisitApprovalForLead.mockResolvedValue({
      approvalId: 'approval-1',
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    mockCancelPendingVisitApprovalForBuyer.mockResolvedValue({
      handled: true,
      reply: '*Visit request cancelled*',
    });

    const result = await tryCustomerVisitCancelReschedule({
      ...baseInput,
      customerMessage: 'cancel visit',
    });

    expect(result.committed).toBe(true);
    expect(result.mode).toBe('cancelled');
    expect(mockCancelPendingVisitApprovalForBuyer).toHaveBeenCalledWith({
      companyId: 'company-1',
      leadId: 'lead-1',
    });
    expect(mockApplyVisitMutationFromChat).not.toHaveBeenCalled();
  });

  it('routes confirmed visit changes to the agent instead of mutating the booking', async () => {
    mockFindPendingVisitApprovalForLead.mockResolvedValue(null);
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue({ id: 'visit-1' });

    const result = await tryCustomerVisitCancelReschedule({
      ...baseInput,
      customerMessage: 'reschedule my visit to tomorrow 4pm',
    });

    expect(result.committed).toBe(true);
    expect(result.mode).toBe('already_booked');
    expect(mockNotifyAgentVisitChangeRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        leadId: 'lead-1',
        visitId: 'visit-1',
      }),
    );
    expect(mockApplyVisitMutationFromChat).not.toHaveBeenCalled();
  });
});
