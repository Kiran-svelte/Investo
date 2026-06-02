jest.mock('../../config/redis', () => ({
  getRedis: jest.fn(() => null),
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    lead: { findUnique: jest.fn(), update: jest.fn() },
    visit: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
    conversation: { findUnique: jest.fn(), update: jest.fn() },
    message: { create: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendMessage: jest.fn().mockResolvedValue(true),
  },
}));

import prisma from '../../config/prisma';
import { automationQueueService } from '../../services/automationQueue.service';
import { automationService } from '../../services/automation.service';

describe('automation post-visit follow-up', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-08T10:00:00.000Z'));
    await automationQueueService.clearAll();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('scheduleVisitPostFollowUp enqueues visit_post_follow_up for next day', async () => {
    await automationService.scheduleVisitPostFollowUp('lead-1', 'visit-1');

    const processed: string[] = [];
    jest.setSystemTime(new Date('2026-04-09T11:00:00.000Z'));

    (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
      id: 'lead-1',
      customerName: 'Asha',
      phone: '+919876543210',
      language: 'en',
      locationPreference: 'Bangalore',
      company: {
        whatsappPhone: '+911',
        settings: {
          whatsapp: { provider: 'greenapi', greenapi: { idInstance: '1', apiTokenInstance: 't' } },
        },
      },
    });
    (prisma.lead.update as jest.Mock).mockResolvedValue({});

    await automationQueueService.processDueJobs(async (job) => {
      processed.push(job.type);
      await (automationService as any).executeQueuedJob(job.type, job.data);
    });

    expect(processed).toEqual(['visit_post_follow_up']);
  });
});
