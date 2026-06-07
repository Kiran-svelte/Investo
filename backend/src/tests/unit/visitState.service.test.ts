jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    visit: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    lead: {
      findUnique: jest.fn(),
    },
    company: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../services/leadTransition.service', () => ({
  transitionLeadStatus: jest.fn(),
  transitionLeadToVisitScheduled: jest.fn(),
}));

jest.mock('../../services/notification.engine', () => ({
  notificationEngine: {
    onVisitStatusChange: jest.fn(),
  },
}));

jest.mock('../../services/visitLifecycle.service', () => ({
  emitVisitUpdated: jest.fn(),
  cancelVisitReminderJobs: jest.fn().mockResolvedValue(undefined),
  rescheduleVisitReminderJobs: jest.fn().mockResolvedValue(undefined),
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
import { transitionLeadStatus, transitionLeadToVisitScheduled } from '../../services/leadTransition.service';
import { notificationEngine } from '../../services/notification.engine';
import { markVisitAttended, markVisitNoShow } from '../../services/visitState.service';

describe('visitState.service', () => {
  const visit = {
    id: 'visit-1',
    companyId: 'company-1',
    leadId: 'lead-1',
    agentId: 'agent-1',
    scheduledAt: new Date('2026-06-06T10:00:00.000Z'),
    status: 'scheduled',
    notes: null,
    lead: { id: 'lead-1', status: 'visit_scheduled', customerName: 'Asha', phone: '+919876543210' },
    property: { name: 'Lake Vista' },
    agent: { id: 'agent-1', name: 'Agent', phone: '+919900000000' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue(visit);
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({ ...visit, lead: visit.lead });
    (prisma.company.findUnique as jest.Mock).mockResolvedValue({ id: 'company-1', settings: {} });
  });

  test('markVisitNoShow rejects scheduled → no_show (must be confirmed first)', async () => {
    const result = await markVisitNoShow({
      companyId: 'company-1',
      visitId: 'visit-1',
      notes: 'Agent reported customer did not attend.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_transition');
    expect(prisma.visit.update).not.toHaveBeenCalled();
  });

  test('markVisitNoShow from confirmed marks visit without moving lead to visited', async () => {
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue({ ...visit, status: 'confirmed' });
    (prisma.visit.update as jest.Mock).mockResolvedValue({ ...visit, status: 'no_show' });

    const result = await markVisitNoShow({
      companyId: 'company-1',
      visitId: 'visit-1',
      notes: 'Agent reported customer did not attend.',
    });

    expect(result.success).toBe(true);
    expect(prisma.visit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit-1' },
        data: expect.objectContaining({ status: 'no_show' }),
      }),
    );
    expect(transitionLeadStatus).not.toHaveBeenCalled();
    expect(transitionLeadToVisitScheduled).not.toHaveBeenCalled();
  });

  test('markVisitAttended rejects scheduled → completed', async () => {
    const result = await markVisitAttended({
      companyId: 'company-1',
      visitId: 'visit-1',
      notes: 'Attendance confirmed by assigned agent.',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_transition');
    expect(prisma.visit.update).not.toHaveBeenCalled();
  });

  test('markVisitAttended from confirmed completes visit before moving lead to visited', async () => {
    const confirmedVisit = { ...visit, status: 'confirmed' };
    const completedVisit = { ...visit, status: 'completed' };
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue(confirmedVisit);
    (prisma.visit.update as jest.Mock).mockResolvedValue(completedVisit);
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue(completedVisit);
    (prisma.lead.findUnique as jest.Mock).mockResolvedValue({ status: 'visit_scheduled' });
    (transitionLeadStatus as jest.Mock).mockResolvedValue(true);

    const result = await markVisitAttended({
      companyId: 'company-1',
      visitId: 'visit-1',
      notes: 'Attendance confirmed by assigned agent.',
    });

    expect(result.success).toBe(true);
    expect(prisma.visit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit-1' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
    expect(transitionLeadStatus).toHaveBeenCalledWith('lead-1', 'visited', { force: false });
    expect(notificationEngine.onVisitStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'visit-1', status: 'completed' }),
      'confirmed',
      'completed',
      expect.objectContaining({ id: 'lead-1' }),
      expect.objectContaining({ id: 'company-1' }),
      false,
    );
  });
});
