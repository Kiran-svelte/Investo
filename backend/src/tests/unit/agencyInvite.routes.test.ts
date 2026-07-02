/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

type MockAgencyInviteService = {
  acceptAgencyInvite: jest.Mock;
  buildAgencyInviteEmailDelivery: jest.Mock;
  createAgencyInvite: jest.Mock;
  getInviteTokenFingerprint: jest.Mock;
  getInviteByToken: jest.Mock;
  listAgencyInvites: jest.Mock;
  resendAgencyInvite: jest.Mock;
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function normalizeDelivery(input: {
  status?: string | null;
  messageId?: string | null;
  lastError?: string | null;
  lastAttemptAt?: Date | null;
  sentAt?: Date | null;
}) {
  const status = input.status === 'sent' ? 'sent' : input.status === 'failed' ? 'failed' : 'pending';
  return {
    status,
    sent: status === 'sent',
    reason: input.lastError || undefined,
    messageId: input.messageId ?? null,
    lastAttemptAt: input.lastAttemptAt ?? null,
    sentAt: input.sentAt ?? null,
  };
}

function createAgencyInviteApp(overrides: Partial<MockAgencyInviteService> = {}): {
  app: Express;
  service: MockAgencyInviteService;
} {
  jest.resetModules();

  const service: MockAgencyInviteService = {
    acceptAgencyInvite: jest.fn().mockResolvedValue({ companyId: 'company-1', userId: 'user-1' }),
    buildAgencyInviteEmailDelivery: jest.fn(normalizeDelivery),
    createAgencyInvite: jest.fn().mockResolvedValue({
      id: 'invite-1',
      token: 'token-1',
      inviteUrl: 'https://app.example/accept-invite/token-1',
      expiresAt: new Date('2026-07-25T00:00:00.000Z'),
      emailDelivery: {
        status: 'sent',
        sent: true,
        messageId: 'msg-1',
        sentAt: new Date('2026-06-26T00:00:00.000Z'),
      },
    }),
    getInviteTokenFingerprint: jest.fn().mockReturnValue('tokenhash123'),
    getInviteByToken: jest.fn().mockResolvedValue({
      agencyName: 'ABC Realty',
      adminEmail: 'admin@example.com',
      expiresAt: new Date('2026-07-25T00:00:00.000Z'),
      status: 'pending',
      negotiatedMonthlyPrice: 3,
    }),
    listAgencyInvites: jest.fn().mockResolvedValue([]),
    resendAgencyInvite: jest.fn().mockResolvedValue({
      id: 'invite-1',
      inviteUrl: 'https://app.example/accept-invite/token-1',
      emailDelivery: {
        status: 'sent',
        sent: true,
        messageId: 'msg-2',
      },
    }),
    ...overrides,
  };

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: {
      features: { billing: true },
      frontend: { baseUrl: 'https://app.example' },
    },
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

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'platform-admin-1',
        role: 'super_admin',
        email: 'admin@investo.in',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    hasRole: () => noopMiddleware(),
  }));

  jest.doMock('../../utils/staffPhoneUniqueness', () => ({
    __esModule: true,
    StaffPhoneInUseError: class StaffPhoneInUseError extends Error {
      constructor() {
        super('This mobile number is already registered to another active user.');
      }
    },
  }));

  jest.doMock('../../services/billing/agencyInvite.service', () => ({
    __esModule: true,
    ...service,
  }));

  let agencyInviteRoutes: any;
  jest.isolateModules(() => {
    agencyInviteRoutes = require('../../routes/agencyInvite.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/agency-invites', agencyInviteRoutes);
  return { app, service };
}

describe('agency invite routes', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('accept invite maps transaction timeout to stable retryable code', async () => {
    const { app, service } = createAgencyInviteApp();
    service.acceptAgencyInvite.mockRejectedValueOnce(new Error('Transaction already closed: timeout'));

    const response = await request(app)
      .post('/api/agency-invites/token-1/accept')
      .send({
        admin_name: 'Kiran R',
        password: 'Password123',
        whatsapp_phone: '+918792592433',
      });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'Account setup took too long and was safely rolled back. Please try again.',
      code: 'invite_accept_timeout',
    });
    expect(service.getInviteTokenFingerprint).toHaveBeenCalledWith('token-1');
  });

  test('create invite returns delivery failure warning instead of claiming mail was sent', async () => {
    const { app, service } = createAgencyInviteApp({
      createAgencyInvite: jest.fn().mockResolvedValue({
        id: 'invite-1',
        token: 'token-1',
        inviteUrl: 'https://app.example/accept-invite/token-1',
        expiresAt: new Date('2026-07-25T00:00:00.000Z'),
        emailDelivery: {
          status: 'failed',
          sent: false,
          reason: 'mail_not_configured',
        },
      }),
    });

    const response = await request(app)
      .post('/api/agency-invites')
      .send({
        agency_name: 'ABC Realty',
        admin_email: 'admin@example.com',
        negotiated_monthly_price: 3,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.emailDelivery).toEqual({
      status: 'failed',
      sent: false,
      reason: 'mail_not_configured',
    });
    expect(response.body.warning).toMatch(/email delivery failed/i);
    expect(response.body.warning).toMatch(/Copy the link/i);
    expect(service.createAgencyInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyName: 'ABC Realty',
        adminEmail: 'admin@example.com',
        createdById: 'platform-admin-1',
      }),
    );
  });

  test('resend invite exposes updated delivery state and retry warning', async () => {
    const { app } = createAgencyInviteApp({
      resendAgencyInvite: jest.fn().mockResolvedValue({
        id: 'invite-1',
        inviteUrl: 'https://app.example/accept-invite/token-1',
        emailDelivery: {
          status: 'failed',
          sent: false,
          reason: 'resend_rejected',
        },
      }),
    });

    const response = await request(app).post('/api/agency-invites/invite-1/resend').send({});

    expect(response.status).toBe(200);
    expect(response.body.data.emailDelivery).toEqual({
      status: 'failed',
      sent: false,
      reason: 'resend_rejected',
    });
    expect(response.body.warning).toMatch(/still not delivered/i);
  });

  test('list invite response includes delivery status for admin UI retry controls', async () => {
    const lastAttemptAt = new Date('2026-06-26T08:00:00.000Z');
    const { app } = createAgencyInviteApp({
      listAgencyInvites: jest.fn().mockResolvedValue([
        {
          id: 'invite-1',
          token: 'token-1',
          agencyName: 'ABC Realty',
          adminEmail: 'admin@example.com',
          expiresAt: new Date('2026-07-25T00:00:00.000Z'),
          acceptedAt: null,
          companyId: null,
          negotiatedMonthlyPrice: 3,
          emailDeliveryStatus: 'failed',
          emailMessageId: null,
          emailLastError: 'resend_rejected',
          emailLastAttemptAt: lastAttemptAt,
          emailSentAt: null,
        },
      ]),
    });

    const response = await request(app).get('/api/agency-invites');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      id: 'invite-1',
      inviteUrl: 'https://app.example/accept-invite/token-1',
      emailDelivery: {
        status: 'failed',
        sent: false,
        reason: 'resend_rejected',
      },
    });
  });
});
