const mockExecuteRaw = jest.fn().mockResolvedValue(undefined);
const mockQueryRaw = jest.fn();
const mockNotify = jest.fn().mockResolvedValue(undefined);
const mockSendButtons = jest.fn().mockResolvedValue(true);
const mockScheduleJob = jest.fn().mockResolvedValue(true);
const mockCancelJob = jest.fn().mockResolvedValue(true);
const mockCreateApproval = jest.fn();
const mockFindPendingApproval = jest.fn();
const mockUpdatePendingApproval = jest.fn();
const mockResolveApproval = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    $executeRawUnsafe: (...args: unknown[]) => mockExecuteRaw(...args),
    $queryRawUnsafe: (...args: unknown[]) => mockQueryRaw(...args),
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../config/redis', () => ({
  getRedis: jest.fn(() => null),
}));

jest.mock('../../services/leadRouting.service', () => ({
  assignLeadWithRouting: jest.fn(),
}));

jest.mock('../../services/notification.engine', () => ({
  notificationEngine: {
    notify: (...args: unknown[]) => mockNotify(...args),
  },
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyInteractiveButtons: (...args: unknown[]) => mockSendButtons(...args),
    sendCompanyTextMessage: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../services/automationQueue.service', () => ({
  automationQueueService: {
    schedule: (...args: unknown[]) => mockScheduleJob(...args),
    cancel: (...args: unknown[]) => mockCancelJob(...args),
  },
}));

jest.mock('../../services/socket.service', () => ({
  SOCKET_EVENTS: { CALL_CREATED: 'call_created', CALL_UPDATED: 'call_updated' },
  socketService: { emitToCompany: jest.fn() },
}));

jest.mock('../../services/bookingApproval.service', () => ({
  buildCallApprovalIdempotencyKey: jest.fn((input: any) => `call_approval:${input.companyId}:${input.leadId}:${input.scheduledAt.toISOString()}`),
  createBookingApprovalRequest: (...args: unknown[]) => mockCreateApproval(...args),
  findPendingBookingApproval: (...args: unknown[]) => mockFindPendingApproval(...args),
  updatePendingBookingApprovalSchedule: (...args: unknown[]) => mockUpdatePendingApproval(...args),
  resolveBookingApprovalStatus: (...args: unknown[]) => mockResolveApproval(...args),
}));

jest.mock('../../services/opsMetrics.service', () => ({
  incrementOpsMetric: jest.fn(),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../config/prisma';
import {
  confirmCallRequest,
  scheduleCallRequest,
} from '../../services/callRequest.service';

function callRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    company_id: 'company-1',
    lead_id: 'lead-1',
    agent_id: 'agent-1',
    scheduled_at: new Date(Date.now() + 3 * 60 * 60 * 1000),
    duration_minutes: 15,
    status: 'pending_approval',
    notes: 'Callback via WhatsApp',
    agent_confirmed_at: null,
    ...overrides,
  };
}

describe('callRequest.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.lead.findFirst as jest.Mock).mockResolvedValue({ assignedAgentId: 'agent-1' });
    (prisma.lead.findUnique as jest.Mock).mockResolvedValue({ customerName: 'Ravi', phone: '+919999988888' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: 'Agent', phone: '+918888877777' });
    mockFindPendingApproval.mockResolvedValue(null);
    mockCreateApproval.mockResolvedValue({
      approval: {
        id: 'approval-1',
        callRequestId: 'call-1',
        leadId: 'lead-1',
        scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      },
      created: true,
      idempotencyHit: false,
    });
  });

  it('creates buyer call requests as pending approval without customer reminder jobs', async () => {
    const scheduledAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([callRow({ scheduled_at: scheduledAt })]);

    const result = await scheduleCallRequest({
      companyId: 'company-1',
      leadId: 'lead-1',
      scheduledAt,
      notes: 'call me tomorrow',
    });

    expect(result.success).toBe(true);
    expect(result.call?.status).toBe('pending_approval');
    expect(mockQueryRaw.mock.calls[1][0]).toContain("'pending_approval'");
    expect(mockCreateApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'call',
        callRequestId: 'call-1',
        leadId: 'lead-1',
      }),
    );
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'call_requested' }));
    expect(mockScheduleJob).not.toHaveBeenCalledWith('call_reminder_1h', expect.anything(), expect.anything(), expect.anything());
  });

  it('schedules the customer call reminder only after agent confirmation', async () => {
    const scheduledAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    mockQueryRaw.mockResolvedValueOnce([callRow({ scheduled_at: scheduledAt, status: 'confirmed' })]);

    const result = await confirmCallRequest({ companyId: 'company-1', callId: 'call-1' });

    expect(result.success).toBe(true);
    expect(mockScheduleJob).toHaveBeenCalledWith(
      'call_reminder_1h',
      'call-1',
      expect.any(Date),
      expect.objectContaining({ callId: 'call-1', companyId: 'company-1', leadId: 'lead-1' }),
    );
  });
});
