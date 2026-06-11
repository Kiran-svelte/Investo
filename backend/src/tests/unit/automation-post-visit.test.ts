jest.mock('../../config/redis', () => ({
  getRedis: jest.fn(() => null),
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    lead: { findUnique: jest.fn(), update: jest.fn() },
    visit: { findUnique: jest.fn(), update: jest.fn() },
    notification: { create: jest.fn() },
    conversation: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    message: { create: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendMessage: jest.fn().mockResolvedValue(true),
    sendCompanyTextMessage: jest.fn().mockResolvedValue(true),
    resolveCompanyWhatsAppConfig: jest.fn().mockResolvedValue({
      provider: 'meta',
      phoneNumberId: 'phone-1',
      accessToken: 'token-1',
      verifyToken: 'verify-1',
    }),
  },
}));

import prisma from '../../config/prisma';
import { whatsappService } from '../../services/whatsapp.service';
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
      companyId: 'company-1',
      company: {
        whatsappPhone: '+911',
        settings: {
          whatsapp: { provider: 'meta', meta: { phoneNumberId: 'phone-1', accessToken: 'token-1' } },
        },
      },
    });
    (prisma.lead.update as jest.Mock).mockResolvedValue({});
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue({ id: 'conv-1' });

    await automationQueueService.processDueJobs(async (job) => {
      processed.push(job.type);
      await (automationService as any).executeQueuedJob(job.type, job.data);
    });

    expect(processed).toEqual(['visit_post_follow_up']);
    const sentMessage = (whatsappService.sendMessage as jest.Mock).mock.calls[0]?.[1] as string
      ?? (whatsappService.sendCompanyTextMessage as jest.Mock).mock.calls[0]?.[1] as string;
    expect(sentMessage).toContain('How was your site visit yesterday?');
    expect(sentMessage).not.toMatch(/[ðàâ]/);
  });

  test('visit reminder message is customer-readable and not mojibake', async () => {
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({
      id: 'visit-1',
      status: 'confirmed',
      companyId: 'company-1',
      leadId: 'lead-1',
      scheduledAt: new Date('2026-04-09T10:00:00.000Z'),
      lead: {
        id: 'lead-1',
        customerName: 'Asha',
        phone: '+919876543210',
        language: 'en',
      },
      property: {
        name: 'Sunset Heights',
        locationArea: 'Indiranagar',
      },
      company: {
        whatsappPhone: '+911',
        settings: {
          whatsapp: { provider: 'meta', meta: { phoneNumberId: 'phone-1', accessToken: 'token-1' } },
        },
      },
    });
    (prisma.visit.update as jest.Mock).mockResolvedValue({});

    await (automationService as any).executeQueuedJob('visit_reminder_24h', { visitId: 'visit-1' });

    const sentMessage = (whatsappService.sendMessage as jest.Mock).mock.calls[0]?.[1] as string
      ?? (whatsappService.sendCompanyTextMessage as jest.Mock).mock.calls[0]?.[1] as string;
    expect(sentMessage).toContain('Reminder: Your property visit is scheduled for tomorrow.');
    expect(sentMessage).toContain('Property: Sunset Heights, Indiranagar');
    expect(sentMessage).not.toMatch(/[ðàâ]/);
  });
});
