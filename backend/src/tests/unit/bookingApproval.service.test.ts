const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    bookingApprovalRequest: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

jest.mock('../../services/automationQueue.service', () => ({
  automationQueueService: {
    schedule: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/opsMetrics.service', () => ({
  incrementOpsMetric: jest.fn(),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockSendText = jest.fn().mockResolvedValue(true);

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: (...args: unknown[]) => mockSendText(...args),
  },
}));

import {
  buildVisitApprovalIdempotencyKey,
  createBookingApprovalRequest,
  expireBookingApproval,
} from '../../services/bookingApproval.service';
import { incrementOpsMetric } from '../../services/opsMetrics.service';

describe('bookingApproval.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('buildVisitApprovalIdempotencyKey is stable for same inputs', () => {
    const scheduledAt = new Date('2026-06-10T10:00:00.000Z');
    const key = buildVisitApprovalIdempotencyKey({
      companyId: 'co-1',
      leadId: 'lead-1',
      propertyId: 'prop-1',
      scheduledAt,
    });
    expect(key).toBe('visit_approval:co-1:lead-1:prop-1:2026-06-10T10:00:00.000Z');
  });

  it('createBookingApprovalRequest returns idempotency hit for duplicate pending key', async () => {
    const existingRow = {
      id: 'appr-1',
      companyId: 'co-1',
      kind: 'visit',
      status: 'pending',
      leadId: 'lead-1',
      agentId: 'agent-1',
      propertyId: 'prop-1',
      callRequestId: null,
      scheduledAt: new Date('2026-06-10T10:00:00.000Z'),
      customerPhone: '+919999999999',
      customerName: 'Ravi',
      conversationId: 'conv-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date('2026-06-10T14:00:00.000Z'),
      resolvedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockFindUnique.mockResolvedValue(existingRow);

    const result = await createBookingApprovalRequest({
      companyId: 'co-1',
      kind: 'visit',
      leadId: 'lead-1',
      agentId: 'agent-1',
      propertyId: 'prop-1',
      scheduledAt: new Date('2026-06-10T10:00:00.000Z'),
      customerPhone: '+919999999999',
      idempotencyKey: 'idem-1',
    });

    expect(result.created).toBe(false);
    expect(result.idempotencyHit).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(incrementOpsMetric).toHaveBeenCalledWith('booking_approval_idem_hit');
  });

  it('expireBookingApproval auto-declines pending visit and notifies buyer after 4h TTL', async () => {
    const expiredRow = {
      id: 'appr-expired',
      companyId: 'co-1',
      kind: 'visit',
      status: 'pending',
      leadId: 'lead-1',
      agentId: 'agent-1',
      propertyId: 'prop-1',
      callRequestId: null,
      scheduledAt: new Date('2026-06-10T10:00:00.000Z'),
      customerPhone: '+919999999999',
      customerName: 'Ravi',
      conversationId: 'conv-1',
      idempotencyKey: 'idem-expired',
      expiresAt: new Date(Date.now() - 60_000),
      resolvedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockFindUnique
      .mockResolvedValueOnce(expiredRow)   // getBookingApprovalById
      .mockResolvedValueOnce(expiredRow)   // resolveBookingApprovalStatus: check current status
      .mockResolvedValueOnce({ ...expiredRow, status: 'expired', resolvedAt: new Date() }); // resolveBookingApprovalStatus: post-updateMany fetch
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const expired = await expireBookingApproval('appr-expired');

    expect(expired).toBe(true);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appr-expired', status: 'pending' },
        data: expect.objectContaining({ status: 'expired' }),
      }),
    );
    expect(mockSendText).toHaveBeenCalledWith(
      '+919999999999',
      expect.stringContaining('could not confirm your visit request in time'),
      'co-1',
    );
  });

  it('expireBookingApproval returns false when TTL has not elapsed', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'appr-1',
      companyId: 'co-1',
      kind: 'visit',
      status: 'pending',
      leadId: 'lead-1',
      agentId: 'agent-1',
      propertyId: 'prop-1',
      callRequestId: null,
      scheduledAt: new Date('2026-06-10T10:00:00.000Z'),
      customerPhone: '+919999999999',
      customerName: 'Ravi',
      conversationId: 'conv-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      resolvedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const expired = await expireBookingApproval('appr-1');
    expect(expired).toBe(false);
    expect(mockSendText).not.toHaveBeenCalled();
  });
});
