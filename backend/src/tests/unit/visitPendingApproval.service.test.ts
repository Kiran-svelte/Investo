const mockScheduleVisit = jest.fn();
const mockConfirmVisitById = jest.fn();
const mockRescheduleVisitById = jest.fn();
const mockFindPendingBookingApproval = jest.fn();
const mockResolveBookingApprovalStatus = jest.fn();
const mockGetBookingApprovalById = jest.fn();
const mockTransitionLeadToVisitScheduled = jest.fn();
const mockSendText = jest.fn().mockResolvedValue(true);
const mockEmitVisitUpdated = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    property: { findUnique: jest.fn() },
    conversation: { update: jest.fn().mockResolvedValue({}) },
  },
}));

jest.mock('../../services/visitBooking.service', () => ({
  scheduleVisit: (...args: unknown[]) => mockScheduleVisit(...args),
}));

jest.mock('../../services/visitState.service', () => ({
  confirmVisitById: (...args: unknown[]) => mockConfirmVisitById(...args),
  rescheduleVisitById: (...args: unknown[]) => mockRescheduleVisitById(...args),
}));

jest.mock('../../services/bookingApproval.service', () => ({
  findPendingBookingApproval: (...args: unknown[]) => mockFindPendingBookingApproval(...args),
  resolveBookingApprovalStatus: (...args: unknown[]) => mockResolveBookingApprovalStatus(...args),
  getBookingApprovalById: (...args: unknown[]) => mockGetBookingApprovalById(...args),
  buildVisitApprovalIdempotencyKey: jest.fn(),
  createBookingApprovalRequest: jest.fn(),
  updatePendingBookingApprovalSchedule: jest.fn(),
  cancelPendingBookingApproval: jest.fn(),
}));

jest.mock('../../services/leadTransition.service', () => ({
  transitionLeadToVisitScheduled: (...args: unknown[]) => mockTransitionLeadToVisitScheduled(...args),
}));

jest.mock('../../services/visitLifecycle.service', () => ({
  emitVisitUpdated: (...args: unknown[]) => mockEmitVisitUpdated(...args),
}));

jest.mock('../../services/socket.service', () => ({
  socketService: { emitToCompany: jest.fn() },
  SOCKET_EVENTS: { LEAD_UPDATED: 'lead:updated' },
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: (...args: unknown[]) => mockSendText(...args),
    sendCompanyInteractiveButtons: jest.fn(),
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../config/prisma';
import {
  resolveVisitApproval,
  tryHandleVisitApprovalInteractive,
} from '../../services/visitPendingApproval.service';

describe('visitPendingApproval.service', () => {
  const approval = {
    id: 'appr-1',
    companyId: 'co-1',
    kind: 'visit' as const,
    status: 'pending' as const,
    leadId: 'lead-1',
    propertyId: 'prop-1',
    callRequestId: null,
    scheduledAt: new Date('2026-06-10T10:00:00+05:30'),
    agentId: 'agent-1',
    conversationId: 'conv-1',
    customerPhone: '+919999988888',
    customerName: 'Ravi',
    idempotencyKey: 'visit_approval:co-1:lead-1:prop-1',
    expiresAt: new Date('2026-06-10T14:00:00+05:30'),
    resolvedAt: null,
    metadata: { propertyName: 'Tower A' },
    createdAt: new Date('2026-06-10T09:00:00+05:30'),
    updatedAt: new Date('2026-06-10T09:00:00+05:30'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindPendingBookingApproval.mockResolvedValue(approval);
    mockGetBookingApprovalById.mockResolvedValue({ ...approval, metadata: {} });
    mockResolveBookingApprovalStatus.mockResolvedValue({ ...approval, status: 'approved' });
    mockScheduleVisit.mockResolvedValue({
      success: true,
      visit: { id: 'visit-1', scheduledAt: approval.scheduledAt },
    });
    mockConfirmVisitById.mockResolvedValue({ success: true });
    mockTransitionLeadToVisitScheduled.mockResolvedValue(true);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: 'Raj' });
    (prisma.property.findUnique as jest.Mock).mockResolvedValue({ name: 'Tower A', locationArea: 'Pune' });
  });

  it('resolveVisitApproval(approved) uses formatBuyerVisitScheduled for customer notify', async () => {
    const result = await resolveVisitApproval('appr-1', true, 'co-1', 'agent-1');

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/10:00\s*am/i);
    expect(mockScheduleVisit).toHaveBeenCalled();
    expect(mockConfirmVisitById).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'co-1', visitId: 'visit-1', suppressCustomerNotification: true }),
    );
    expect(mockTransitionLeadToVisitScheduled).toHaveBeenCalledWith('lead-1');
    expect(mockSendText).toHaveBeenCalledWith(
      '+919999988888',
      expect.stringMatching(/\*Visit scheduled\*/),
      'co-1',
    );
    expect(mockEmitVisitUpdated).toHaveBeenCalledWith('co-1', expect.objectContaining({ id: 'visit-1' }), 'confirmed');
  });

  it('resolveVisitApproval(approved) reschedules when metadata.rescheduleVisitId is set', async () => {
    mockGetBookingApprovalById.mockResolvedValue({
      ...approval,
      metadata: { rescheduleVisitId: 'visit-old' },
    });
    mockRescheduleVisitById.mockResolvedValue({
      success: true,
      visit: { id: 'visit-old', scheduledAt: approval.scheduledAt },
    });

    const result = await resolveVisitApproval('appr-1', true, 'co-1', 'agent-1');

    expect(result.ok).toBe(true);
    expect(mockScheduleVisit).not.toHaveBeenCalled();
    expect(mockRescheduleVisitById).toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith(
      '+919999988888',
      expect.stringMatching(/\*Visit rescheduled\*/),
      'co-1',
    );
    expect(mockEmitVisitUpdated).toHaveBeenCalledWith('co-1', expect.objectContaining({ id: 'visit-old' }), 'rescheduled');
  });

  it('resolveVisitApproval(declined) notifies buyer to pick another slot', async () => {
    const result = await resolveVisitApproval('appr-1', false, 'co-1', 'agent-1');

    expect(result.ok).toBe(true);
    expect(mockResolveBookingApprovalStatus).toHaveBeenCalledWith({ approvalId: 'appr-1', status: 'declined' });
    expect(mockScheduleVisit).not.toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith(
      '+919999988888',
      expect.stringContaining('another date/time'),
      'co-1',
    );
  });

  it('tryHandleVisitApprovalInteractive handles visit-approve-{id}', async () => {
    const handled = await tryHandleVisitApprovalInteractive('visit-approve-appr-1', {
      userId: 'agent-1',
      companyId: 'co-1',
      phone: '+919888877777',
    });

    expect(handled).toBe(true);
    expect(mockSendText).toHaveBeenCalledWith(
      '+919888877777',
      expect.stringContaining('Visit confirmed'),
      'co-1',
    );
  });
});
