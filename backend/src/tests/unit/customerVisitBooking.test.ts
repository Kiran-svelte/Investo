const mockFindPendingVisitApprovalForLead = jest.fn();
const mockCreateVisitApprovalRequest = jest.fn();
const mockIsVisitAutoConfirmEnabled = jest.fn();
const mockScheduleVisit = jest.fn();
const mockAssignLeadRoundRobin = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    visit: { findFirst: jest.fn() },
    conversation: { findUnique: jest.fn() },
    property: { findFirst: jest.fn(), findUnique: jest.fn() },
    lead: { update: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../services/visitPendingApproval.service', () => ({
  cancelPendingVisitApprovalForBuyer: jest.fn(),
  createVisitApprovalRequest: (...args: unknown[]) => mockCreateVisitApprovalRequest(...args),
  findPendingVisitApprovalForLead: (...args: unknown[]) => mockFindPendingVisitApprovalForLead(...args),
  notifyAgentVisitChangeRequested: jest.fn(),
  reschedulePendingVisitApprovalForBuyer: jest.fn(),
}));

jest.mock('../../services/visitAutoConfirm.service', () => ({
  isVisitAutoConfirmEnabled: (...args: unknown[]) => mockIsVisitAutoConfirmEnabled(...args),
}));

jest.mock('../../services/visitBooking.service', () => ({
  buildVisitIdempotencyKey: jest.fn(
    (companyId: string, leadId: string, iso: string) => `visit_book:${companyId}:${leadId}:${iso}`,
  ),
  scheduleVisit: (...args: unknown[]) => mockScheduleVisit(...args),
}));

jest.mock('../../services/leadAssignment.service', () => ({
  assignLeadRoundRobin: (...args: unknown[]) => mockAssignLeadRoundRobin(...args),
}));

jest.mock('../../services/buyerPropertyContext.service', () => ({
  resolveBuyerPropertyReference: jest.fn(async ({ selectedPropertyId }: { selectedPropertyId: string | null }) =>
    selectedPropertyId,
  ),
}));

jest.mock('../../services/visitMutationFromChat.service', () => ({
  applyVisitMutationFromChat: jest.fn(),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../config/prisma';
import { tryCommitCustomerVisitBooking } from '../../services/customerVisitBooking.service';

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

describe('tryCommitCustomerVisitBooking (chunk 06)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindPendingVisitApprovalForLead.mockResolvedValue(null);
    mockIsVisitAutoConfirmEnabled.mockResolvedValue(false);
    mockAssignLeadRoundRobin.mockResolvedValue('agent-1');
    mockCreateVisitApprovalRequest.mockResolvedValue(undefined);
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      stage: 'visit_booking',
      commitments: {},
      proposedVisitTime: null,
    });
    (prisma.property.findFirst as jest.Mock).mockResolvedValue({ name: 'Sunset Heights' });
  });

  it('returns committed:false when no visit datetime can be parsed', async () => {
    const result = await tryCommitCustomerVisitBooking({
      ...baseInput,
      customerMessage: 'book a visit',
    });

    expect(result.committed).toBe(false);
    expect(mockCreateVisitApprovalRequest).not.toHaveBeenCalled();
    expect(mockScheduleVisit).not.toHaveBeenCalled();
  });

  it('submits pending approval by default (autoConfirmVisits=false)', async () => {
    const result = await tryCommitCustomerVisitBooking({
      ...baseInput,
      customerMessage: 'book visit Tuesday 3pm',
    });

    expect(result.committed).toBe(true);
    expect(result.mode).toBe('pending_approval');
    expect(result.leadStatus).toBe('contacted');
    expect(mockCreateVisitApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        leadId: 'lead-1',
        propertyId: 'property-1',
        suppressCustomerMessage: true,
      }),
    );
    expect(mockScheduleVisit).not.toHaveBeenCalled();
  });

  it('schedules directly when autoConfirmVisits=true', async () => {
    mockIsVisitAutoConfirmEnabled.mockResolvedValue(true);
    mockScheduleVisit.mockResolvedValue({
      success: true,
      visit: {
        id: 'visit-1',
        scheduledAt: new Date('2030-06-10T09:30:00.000Z'),
        agentId: 'agent-1',
        propertyId: 'property-1',
        leadId: 'lead-1',
        companyId: 'company-1',
        durationMinutes: 60,
        status: 'scheduled',
        notes: null,
      },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: 'Priya' });

    const result = await tryCommitCustomerVisitBooking({
      ...baseInput,
      customerMessage: 'schedule site visit Saturday 11am',
    });

    expect(result.committed).toBe(true);
    expect(result.mode).toBe('scheduled');
    expect(result.leadStatus).toBe('visit_scheduled');
    expect(result.visitId).toBe('visit-1');
    expect(mockScheduleVisit).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        leadId: 'lead-1',
        propertyId: 'property-1',
        notes: 'Booked via WhatsApp text commit',
      }),
    );
    expect(mockCreateVisitApprovalRequest).not.toHaveBeenCalled();
  });

  it('suggests cancel_visit workflow when BUYER_VISIT_WORKFLOW_ENABLED and active visit exists', async () => {
    const prev = process.env.BUYER_VISIT_WORKFLOW_ENABLED;
    process.env.BUYER_VISIT_WORKFLOW_ENABLED = '1';
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue({ id: 'visit-9' });

    const result = await tryCommitCustomerVisitBooking({
      ...baseInput,
      customerMessage: 'cancel my visit',
    });

    process.env.BUYER_VISIT_WORKFLOW_ENABLED = prev;

    expect(result.committed).toBe(false);
    expect(result.workflowSuggestion?.workflowId).toBe('cancel_visit');
    expect(result.workflowSuggestion?.parameters).toEqual(
      expect.objectContaining({ leadId: 'lead-1', visitId: 'visit-9' }),
    );
  });
});
