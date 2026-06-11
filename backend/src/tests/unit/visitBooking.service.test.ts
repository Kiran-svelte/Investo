jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    property: {
      findFirst: jest.fn(),
    },
    visit: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../../services/leadAssignment.service', () => ({
  assignLeadRoundRobin: jest.fn(),
}));

jest.mock('../../services/notification.engine', () => ({
  notificationEngine: {
    onVisitScheduled: jest.fn(),
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import prisma from '../../config/prisma';
import {
  parseVisitTimeInteractiveId,
  resolveVisitSlotToDate,
  scheduleVisit,
} from '../../services/visitBooking.service';
import { formatISTDateTime } from '../../utils/dateTime.util';

describe('visitBooking.service', () => {
  const propertyId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parseVisitTimeInteractiveId parses UUID and tomorrow-10am', () => {
    const parsed = parseVisitTimeInteractiveId(`visit-time-${propertyId}-tomorrow-10am`);
    expect(parsed).toEqual({ propertyId, slot: 'tomorrow-10am' });
  });

  test('parseVisitTimeInteractiveId parses dayafter slot', () => {
    const parsed = parseVisitTimeInteractiveId(`visit-time-${propertyId}-dayafter`);
    expect(parsed).toEqual({ propertyId, slot: 'dayafter' });
  });

  test('parseVisitTimeInteractiveId returns null for invalid id', () => {
    expect(parseVisitTimeInteractiveId('visit-time-short-bad')).toBeNull();
  });

  test('resolveVisitSlotToDate stores 10am IST as 04:30 UTC', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-11T10:00:00.000Z'));
    const d = resolveVisitSlotToDate('tomorrow-10am');
    jest.useRealTimers();

    expect(d.toISOString()).toBe('2026-06-12T04:30:00.000Z');
    expect(formatISTDateTime(d)).toMatch(/10:00\s*am/i);
  });

  test('scheduleVisit rejects leads that cannot enter visit_scheduled before creating a visit', async () => {
    (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
      id: 'lead-closed',
      companyId: 'company-1',
      status: 'closed_lost',
      assignedAgentId: 'agent-1',
    });

    const result = await scheduleVisit({
      companyId: 'company-1',
      leadId: 'lead-closed',
      propertyId,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    expect(result).toEqual({ success: false, error: 'invalid_lead_transition' });
    expect(prisma.property.findFirst).not.toHaveBeenCalled();
    expect(prisma.visit.create).not.toHaveBeenCalled();
  });
});
