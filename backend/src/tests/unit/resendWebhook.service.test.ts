/// <reference types="jest" />

type MockPrisma = {
  agencyInvite: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
};

function loadService(prismaOverrides: Partial<MockPrisma['agencyInvite']> = {}) {
  jest.resetModules();

  const prisma: MockPrisma = {
    agencyInvite: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      ...prismaOverrides,
    },
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: prisma,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));

  const service = require('../../services/resendWebhook.service');
  return { prisma, service };
}

describe('resendWebhook.service', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('records delivered event against matching agency invite message id', async () => {
    const { prisma, service } = loadService({
      findFirst: jest.fn().mockResolvedValue({
        id: 'invite-1',
        emailDeliveryStatus: 'sent',
        emailLastEventId: null,
      }),
    });

    const result = await service.applyResendEmailEventToAgencyInvite(
      {
        type: 'email.delivered',
        created_at: '2026-06-26T09:00:00.000Z',
        data: { email_id: 'email-1' },
      },
      'svix-1',
    );

    expect(result).toEqual({
      status: 'updated',
      inviteId: 'invite-1',
      emailId: 'email-1',
      deliveryStatus: 'delivered',
    });
    expect(prisma.agencyInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: expect.objectContaining({
        emailDeliveryStatus: 'delivered',
        emailDeliveredAt: new Date('2026-06-26T09:00:00.000Z'),
        emailLastEventAt: new Date('2026-06-26T09:00:00.000Z'),
        emailLastEventId: 'svix-1',
        emailLastError: null,
      }),
    });
  });

  test('keeps webhook processing idempotent for duplicate svix delivery id', async () => {
    const { prisma, service } = loadService({
      findFirst: jest.fn().mockResolvedValue({
        id: 'invite-1',
        emailDeliveryStatus: 'delivered',
        emailLastEventId: 'svix-1',
      }),
    });

    const result = await service.applyResendEmailEventToAgencyInvite(
      {
        type: 'email.delivered',
        data: { email_id: 'email-1' },
      },
      'svix-1',
    );

    expect(result).toEqual({
      status: 'duplicate',
      inviteId: 'invite-1',
      emailId: 'email-1',
    });
    expect(prisma.agencyInvite.update).not.toHaveBeenCalled();
  });

  test('does not downgrade delivered status when an older sent event arrives later', async () => {
    const { prisma, service } = loadService({
      findFirst: jest.fn().mockResolvedValue({
        id: 'invite-1',
        emailDeliveryStatus: 'delivered',
        emailLastEventId: 'svix-delivered',
      }),
    });

    const result = await service.applyResendEmailEventToAgencyInvite(
      {
        type: 'email.sent',
        created_at: '2026-06-26T08:59:00.000Z',
        data: { email_id: 'email-1' },
      },
      'svix-sent',
    );

    expect(result).toEqual({
      status: 'updated',
      inviteId: 'invite-1',
      emailId: 'email-1',
      deliveryStatus: 'delivered',
    });
    expect(prisma.agencyInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: expect.objectContaining({
        emailDeliveryStatus: 'delivered',
        emailSentAt: new Date('2026-06-26T08:59:00.000Z'),
        emailLastEventId: 'svix-sent',
      }),
    });
  });
});
