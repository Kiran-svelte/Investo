/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockPrisma = {
  conversation: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  message: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createConversationApp(): { app: Express; mockPrisma: MockPrisma } {
  jest.resetModules();

  const mockPrisma: MockPrisma = {
    conversation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    message: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
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
        id: 'user-1',
        company_id: 'company-1',
        companyId: 'company-1',
        role: 'company_admin',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    tenantIsolation: noopMiddleware(),
    getCompanyId: () => 'company-1',
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    authorize: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/audit', () => ({
    __esModule: true,
    auditLog: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/featureGate', () => ({
    __esModule: true,
    requireFeature: () => noopMiddleware(),
  }));

  // Not used by these GET routes, but required at import time.
  jest.doMock('../../services/whatsapp.service', () => ({
    __esModule: true,
    whatsappService: {
      sendMessage: jest.fn(),
      sendDocument: jest.fn(),
      sendInteractiveButtons: jest.fn(),
    },
  }));

  jest.doMock('../../services/socket.service', () => ({
    __esModule: true,
    socketService: {
      emitToCompany: jest.fn(),
    },
    SOCKET_EVENTS: {
      MESSAGE_NEW: 'message:new',
      CONVERSATION_UPDATED: 'conversation:updated',
    },
  }));

  let conversationRouter: any;
  jest.isolateModules(() => {
    conversationRouter = require('../../routes/conversation.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationRouter);

  return { app, mockPrisma };
}

describe('conversation routes DTO shape', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('GET /api/conversations returns snake_case conversation fields', async () => {
    const { app, mockPrisma } = createConversationApp();

    mockPrisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv-1',
        companyId: 'company-1',
        leadId: 'lead-1',
        whatsappPhone: '+919876543210',
        status: 'agent_active',
        language: 'en',
        aiEnabled: true,
        stage: 'rapport',
        stageEnteredAt: new Date('2026-04-09T09:00:00.000Z'),
        stageMessageCount: 0,
        commitments: {},
        objectionCount: 0,
        lastObjectionType: null,
        consecutiveObjections: 0,
        urgencyScore: 5,
        valueScore: 5,
        escalationReason: null,
        escalatedAt: null,
        recommendedPropertyIds: [],
        selectedPropertyId: null,
        proposedVisitTime: null,
        createdAt: new Date('2026-04-09T08:00:00.000Z'),
        updatedAt: new Date('2026-04-09T10:00:00.000Z'),
        lead: {
          customerName: 'Asha',
          phone: '+919876543210',
          assignedAgentId: 'agent-1',
        },
      },
    ]);

    mockPrisma.message.findFirst.mockResolvedValue({
      id: 'msg-1',
      conversationId: 'conv-1',
      senderType: 'customer',
      content: 'Hello agent',
      language: 'en',
      whatsappMessageId: null,
      status: 'sent',
      createdAt: new Date('2026-04-09T09:59:00.000Z'),
    });

    const response = await request(app).get('/api/conversations');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);

    expect(response.body.data[0]).toEqual(
      expect.objectContaining({
        id: 'conv-1',
        lead_id: 'lead-1',
        customer_name: 'Asha',
        customer_phone: '+919876543210',
        ai_enabled: true,
        updated_at: '2026-04-09T10:00:00.000Z',
      }),
    );

    expect(response.body.data[0].last_message).toEqual(
      expect.objectContaining({
        content: 'Hello agent',
        sender_type: 'customer',
        created_at: '2026-04-09T09:59:00.000Z',
      }),
    );

    expect(response.body.data[0].updatedAt).toBeUndefined();
    expect(response.body.data[0].aiEnabled).toBeUndefined();
  });

  test('GET /api/conversations/:id returns snake_case messages and timestamps', async () => {
    const { app, mockPrisma } = createConversationApp();

    mockPrisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      companyId: 'company-1',
      leadId: 'lead-1',
      whatsappPhone: '+919876543210',
      status: 'agent_active',
      language: 'en',
      aiEnabled: true,
      stage: 'rapport',
      stageEnteredAt: new Date('2026-04-09T09:00:00.000Z'),
      stageMessageCount: 0,
      commitments: {},
      objectionCount: 0,
      lastObjectionType: null,
      consecutiveObjections: 0,
      urgencyScore: 5,
      valueScore: 5,
      escalationReason: null,
      escalatedAt: null,
      recommendedPropertyIds: [],
      selectedPropertyId: null,
      proposedVisitTime: null,
      createdAt: new Date('2026-04-09T08:00:00.000Z'),
      updatedAt: new Date('2026-04-09T10:00:00.000Z'),
      lead: {
        customerName: 'Asha',
        phone: '+919876543210',
        assignedAgentId: 'agent-1',
      },
    });

    mockPrisma.message.findMany.mockResolvedValue([
      {
        id: 'msg-1',
        senderType: 'customer',
        content: 'Hi',
        language: 'en',
        whatsappMessageId: 'wamid.1',
        status: 'sent',
        createdAt: new Date('2026-04-09T09:59:00.000Z'),
      },
      {
        id: 'msg-2',
        senderType: 'agent',
        content: 'Hello!',
        language: 'en',
        whatsappMessageId: 'wamid.2',
        status: 'sent',
        createdAt: new Date('2026-04-09T10:00:00.000Z'),
      },
    ]);

    const response = await request(app).get('/api/conversations/conv-1');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        id: 'conv-1',
        lead_id: 'lead-1',
        ai_enabled: true,
        updated_at: '2026-04-09T10:00:00.000Z',
        messages: [
          expect.objectContaining({
            id: 'msg-1',
            sender_type: 'customer',
            content: 'Hi',
            created_at: '2026-04-09T09:59:00.000Z',
          }),
          expect.objectContaining({
            id: 'msg-2',
            sender_type: 'agent',
            content: 'Hello!',
            created_at: '2026-04-09T10:00:00.000Z',
          }),
        ],
      }),
    );

    expect(response.body.data.messages[0].senderType).toBeUndefined();
    expect(response.body.data.messages[0].createdAt).toBeUndefined();
  });
});
