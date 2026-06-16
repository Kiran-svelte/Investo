jest.mock('../../config/redis', () => ({
  getRedis: jest.fn(() => null),
}));

jest.mock('../../utils/featureRollout.util', () => ({
  isFeatureEnabledForLead: jest.fn(() => true),
  isGlobalFeatureEnabled: jest.fn(() => true),
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    lead: { findUnique: jest.fn(), update: jest.fn() },
    visit: { findUnique: jest.fn(), update: jest.fn() },
    conversation: { findFirst: jest.fn() },
    agentActionLog: { findFirst: jest.fn() },
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
import { isFeatureEnabledForLead } from '../../utils/featureRollout.util';
import { automationService } from '../../services/automation.service';

describe('automation customer notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.agentActionLog.findFirst as jest.Mock).mockResolvedValue(null);
  });

  test('visit reminder uses sendCompanyTextMessage when global env credentials are used', async () => {
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
        settings: { whatsapp: {} },
      },
    });

    await (automationService as any).executeQueuedJob('visit_reminder_1h', { visitId: 'visit-1' });

    expect(whatsappService.sendCompanyTextMessage).toHaveBeenCalledWith(
      '+919876543210',
      expect.stringContaining('Your property visit is in 1 hour.'),
      'company-1',
    );
    expect(whatsappService.sendMessage).not.toHaveBeenCalled();
  });

  test('visit reminder sends for scheduled visits when reliable notifications are enabled', async () => {
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({
      id: 'visit-2',
      status: 'scheduled',
      companyId: 'company-1',
      leadId: 'lead-2',
      scheduledAt: new Date('2026-04-09T10:00:00.000Z'),
      lead: {
        id: 'lead-2',
        customerName: 'Ravi',
        phone: '+919876543211',
        language: 'en',
      },
      property: {
        name: 'Lake Vista',
        locationArea: 'Whitefield',
      },
      company: {
        whatsappPhone: '+911',
        settings: { whatsapp: {} },
      },
    });

    await (automationService as any).executeQueuedJob('visit_reminder_24h', { visitId: 'visit-2' });

    expect(whatsappService.sendCompanyTextMessage).toHaveBeenCalled();
  });

  test('visit reminder sends exactly once even when lead is outside rollout bucket', async () => {
    (isFeatureEnabledForLead as jest.Mock).mockReturnValue(false);
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({
      id: 'visit-3',
      status: 'confirmed',
      companyId: 'company-1',
      leadId: 'lead-3',
      scheduledAt: new Date('2026-04-09T10:00:00.000Z'),
      lead: {
        id: 'lead-3',
        customerName: 'Maya',
        phone: '+919876543212',
        language: 'en',
      },
      property: {
        name: 'Sunset Heights 1201',
        locationArea: 'Whitefield',
      },
      company: {
        whatsappPhone: '+911',
        settings: { whatsapp: {} },
      },
    });

    await (automationService as any).executeQueuedJob('visit_reminder_1h', { visitId: 'visit-3' });

    expect(whatsappService.sendMessage).toHaveBeenCalledTimes(1);
    expect(whatsappService.sendCompanyTextMessage).not.toHaveBeenCalled();
  });

  test('visit reminder is idempotent — second execution does not resend', async () => {
    (isFeatureEnabledForLead as jest.Mock).mockReturnValue(true);
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({
      id: 'visit-4',
      status: 'confirmed',
      companyId: 'company-1',
      leadId: 'lead-4',
      scheduledAt: new Date('2026-04-09T10:00:00.000Z'),
      lead: {
        id: 'lead-4',
        customerName: 'Dev',
        phone: '+919876543213',
        language: 'en',
      },
      property: {
        name: 'Lake Vista',
        locationArea: 'Indiranagar',
      },
      company: {
        whatsappPhone: '+911',
        settings: { whatsapp: {} },
      },
    });
    (prisma.agentActionLog.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'log-1' });

    await (automationService as any).executeQueuedJob('visit_reminder_1h', { visitId: 'visit-4' });
    await (automationService as any).executeQueuedJob('visit_reminder_1h', { visitId: 'visit-4' });

    expect(whatsappService.sendCompanyTextMessage).toHaveBeenCalledTimes(1);
  });
});
