import { SOCKET_EVENTS } from '../../services/socket.service';

const mockEmit = jest.fn().mockReturnValue(true);
const mockSchedule = jest.fn().mockResolvedValue(true);
const mockCancel = jest.fn().mockResolvedValue(true);
const mockFindExistingJobsForVisits = jest.fn().mockResolvedValue([]);

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    visit: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../services/socket.service', () => ({
  socketService: { emitToCompany: (...args: unknown[]) => mockEmit(...args) },
  SOCKET_EVENTS: {
    VISIT_CREATED: 'visit:created',
    VISIT_UPDATED: 'visit:updated',
    NOTIFICATION_NEW: 'notification:new',
  },
}));

jest.mock('../../services/automationQueue.service', () => ({
  automationQueueService: {
    schedule: (...args: unknown[]) => mockSchedule(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
    findExistingJobsForVisits: (...args: unknown[]) => mockFindExistingJobsForVisits(...args),
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../config/prisma';

describe('visitLifecycle.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  const sampleVisit = {
    id: 'visit-1',
    leadId: 'lead-1',
    propertyId: 'prop-1',
    agentId: 'agent-1',
    scheduledAt: new Date('2026-06-15T10:00:00+05:30'),
    status: 'scheduled',
    companyId: 'co-1',
  };

  test('emitVisitCreated fires visit:created socket', async () => {
    const { emitVisitCreated } = await import('../../services/visitLifecycle.service');
    emitVisitCreated('co-1', sampleVisit);
    expect(mockEmit).toHaveBeenCalledWith(
      'co-1',
      SOCKET_EVENTS.VISIT_CREATED,
      expect.objectContaining({ leadId: 'lead-1', visit: expect.objectContaining({ id: 'visit-1' }) }),
    );
  });

  test('emitVisitUpdated fires visit:updated socket with change type', async () => {
    const { emitVisitUpdated } = await import('../../services/visitLifecycle.service');
    emitVisitUpdated('co-1', sampleVisit, 'rescheduled');
    expect(mockEmit).toHaveBeenCalledWith(
      'co-1',
      SOCKET_EVENTS.VISIT_UPDATED,
      expect.objectContaining({ change: 'rescheduled' }),
    );
  });

  test('scheduleVisitReminderJobs enqueues 24h and 1h jobs', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { scheduleVisitReminderJobs } = await import('../../services/visitLifecycle.service');
    await scheduleVisitReminderJobs('visit-1', future, 'co-1', 'lead-1');
    expect(mockSchedule).toHaveBeenCalledWith(
      'visit_reminder_24h',
      'visit-1',
      expect.any(Date),
      expect.objectContaining({ visitId: 'visit-1', leadId: 'lead-1' }),
    );
    expect(mockSchedule).toHaveBeenCalledWith(
      'visit_reminder_1h',
      'visit-1',
      expect.any(Date),
      expect.objectContaining({ visitId: 'visit-1' }),
    );
  });

  test('cancelVisitReminderJobs cancels both reminder types', async () => {
    const { cancelVisitReminderJobs } = await import('../../services/visitLifecycle.service');
    await cancelVisitReminderJobs('visit-1');
    expect(mockCancel).toHaveBeenCalledWith('visit_reminder_24h', 'visit-1');
    expect(mockCancel).toHaveBeenCalledWith('visit_reminder_1h', 'visit-1');
  });

  test('reconcileOrphanedVisitReminders re-enqueues missing reminder jobs', async () => {
    // Use 3 days in the future so both 24h and 1h reminder windows are in the future.
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    (prisma.visit.findMany as jest.Mock).mockResolvedValue([
      { id: 'visit-orphan', scheduledAt: future, companyId: 'co-1', leadId: 'lead-1' },
    ]);
    mockFindExistingJobsForVisits.mockResolvedValue([]);

    const { reconcileOrphanedVisitReminders } = await import('../../services/visitLifecycle.service');
    const count = await reconcileOrphanedVisitReminders();

    expect(count).toBe(1);
    expect(mockSchedule).toHaveBeenCalledWith(
      'visit_reminder_24h',
      'visit-orphan',
      expect.any(Date),
      expect.objectContaining({ visitId: 'visit-orphan' }),
    );
    expect(mockSchedule).toHaveBeenCalledWith(
      'visit_reminder_1h',
      'visit-orphan',
      expect.any(Date),
      expect.objectContaining({ visitId: 'visit-orphan' }),
    );
  });
});
