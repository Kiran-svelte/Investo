const mockPrisma = {
  visit: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/notification.engine', () => ({
  notificationEngine: { onVisitRescheduled: jest.fn().mockResolvedValue(undefined) },
}));

import { applyVisitMutationFromChat } from '../../services/visitMutationFromChat.service';

describe('applyVisitMutationFromChat', () => {
  const thursday = new Date('2026-06-04T12:00:00+05:30');
  const tomorrowVisit = {
    id: 'visit-1',
    companyId: 'co-1',
    leadId: 'lead-1',
    scheduledAt: new Date('2026-06-05T13:00:00+05:30'),
    status: 'scheduled',
    property: { name: 'Sunset Heights' },
    lead: { id: 'lead-1', customerName: 'Ravi', phone: '+919999999999' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(thursday);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reschedules tomorrow visit to Saturday 1pm for buyer', async () => {
    mockPrisma.visit.findFirst.mockResolvedValue(tomorrowVisit);
    mockPrisma.visit.update.mockResolvedValue({
      ...tomorrowVisit,
      scheduledAt: new Date('2026-06-06T13:00:00+05:30'),
      property: { name: 'Sunset Heights' },
      lead: tomorrowVisit.lead,
    });

    const result = await applyVisitMutationFromChat({
      companyId: 'co-1',
      leadId: 'lead-1',
      message:
        'Cancel my site visit which is on tomorrow and reschedule it to this saturday 1pm',
    });

    expect(result.handled).toBe(true);
    expect(result.mode).toBe('rescheduled');
    expect(result.reply).toMatch(/Visit rescheduled/i);
    expect(result.reply).toMatch(/Sunset Heights/i);
    expect(mockPrisma.visit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit-1' },
        data: expect.objectContaining({
          scheduledAt: expect.any(Date),
        }),
      }),
    );
    const updatedAt = mockPrisma.visit.update.mock.calls[0][0].data.scheduledAt as Date;
    expect(updatedAt.getDay()).toBe(6);
    expect(updatedAt.getHours()).toBe(13);
  });

  it('returns not handled for unrelated text', async () => {
    const result = await applyVisitMutationFromChat({
      companyId: 'co-1',
      leadId: 'lead-1',
      message: 'What properties do you have?',
    });
    expect(result.handled).toBe(false);
    expect(mockPrisma.visit.findFirst).not.toHaveBeenCalled();
  });
});
