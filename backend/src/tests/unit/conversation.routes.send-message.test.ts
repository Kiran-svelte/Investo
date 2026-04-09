/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockPrisma = {
  conversation: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  company: {
    findUnique: jest.Mock;
  };
  message: {
    create: jest.Mock;
  };
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createConversationApp(options?: { role?: string; assignedAgentId?: string | null }): {
  app: Express;
  mockPrisma: MockPrisma;
  whatsappServiceMock: {
    sendMessage: jest.Mock;
    sendDocument: jest.Mock;
    sendInteractiveButtons: jest.Mock;
  };
  socketServiceMock: {
    emitToCompany: jest.Mock;
  };
} {
  jest.resetModules();

  const role = options?.role || 'company_admin';
  const assignedAgentId = options?.assignedAgentId ?? 'user-1';

  const mockPrisma: MockPrisma = {
    conversation: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'conv-1',
        companyId: 'company-1',
        leadId: 'lead-1',
        whatsappPhone: '+919876543210',
        status: 'ai_active',
        lead: {
          assignedAgentId,
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 'conv-1', status: 'agent_active' }),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue({
        settings: {
          whatsapp: {
            phoneNumberId: 'phone-id-1',
            accessToken: 'wa-token-1',
            verifyToken: 'wa-verify-1',
          },
        },
        whatsappPhone: null,
      }),
    },
    message: {
      create: jest.fn().mockResolvedValue({
        id: 'msg-1',
        senderType: 'agent',
        content: 'hello',
        language: 'en',
        whatsappMessageId: 'wamid.1',
        status: 'sent',
        createdAt: new Date('2026-04-09T10:00:00.000Z'),
      }),
    },
  };

  const whatsappServiceMock = {
    sendMessage: jest.fn().mockResolvedValue(true),
    sendDocument: jest.fn().mockResolvedValue({ success: true, messageId: 'wamid.2' }),
    sendInteractiveButtons: jest.fn().mockResolvedValue({ success: true, messageId: 'wamid.3' }),
  };

  const socketServiceMock = {
    emitToCompany: jest.fn().mockReturnValue(true),
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
        role,
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

  jest.doMock('../../services/whatsapp.service', () => ({
    __esModule: true,
    whatsappService: whatsappServiceMock,
  }));

  jest.doMock('../../services/socket.service', () => ({
    __esModule: true,
    socketService: socketServiceMock,
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

  return {
    app,
    mockPrisma,
    whatsappServiceMock,
    socketServiceMock,
  };
}

describe('conversation send endpoint mode handling', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('POST /api/conversations/:id/messages sends text mode via WhatsApp and persists message', async () => {
    const { app, mockPrisma, whatsappServiceMock, socketServiceMock } = createConversationApp();

    const response = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ mode: 'text', text: 'Hello from agent' });

    expect(response.status).toBe(200);
    expect(whatsappServiceMock.sendMessage).toHaveBeenCalledWith(
      '+919876543210',
      'Hello from agent',
      expect.objectContaining({ phoneNumberId: 'phone-id-1', accessToken: 'wa-token-1' }),
    );
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderType: 'agent',
          content: 'Hello from agent',
        }),
      }),
    );
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'agent_active' },
      }),
    );
    expect(socketServiceMock.emitToCompany).toHaveBeenCalledTimes(2);
  });

  test('POST /api/conversations/:id/messages sends document mode via sendDocument', async () => {
    const { app, mockPrisma, whatsappServiceMock } = createConversationApp();

    const response = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({
        mode: 'document',
        document_url: 'https://cdn.example.com/brochure.pdf',
        filename: 'Brochure.pdf',
        caption: 'Project brochure',
      });

    expect(response.status).toBe(200);
    expect(whatsappServiceMock.sendDocument).toHaveBeenCalledWith(
      '+919876543210',
      'https://cdn.example.com/brochure.pdf',
      'Brochure.pdf',
      'Project brochure',
      expect.any(Object),
    );
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('[Document] Brochure.pdf: https://cdn.example.com/brochure.pdf'),
        }),
      }),
    );
  });

  test('POST /api/conversations/:id/messages sends quick_reply mode via sendInteractiveButtons', async () => {
    const { app, mockPrisma, whatsappServiceMock } = createConversationApp();

    const response = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({
        mode: 'quick_reply',
        body_text: 'Pick a preferred visit slot',
        header_text: 'Visit Booking',
        footer_text: 'Tap one option',
        buttons: [
          { id: 'visit_morning', title: 'Morning' },
          { id: 'visit_evening', title: 'Evening' },
        ],
      });

    expect(response.status).toBe(200);
    expect(whatsappServiceMock.sendInteractiveButtons).toHaveBeenCalledWith(
      '+919876543210',
      'Pick a preferred visit slot',
      [
        { id: 'visit_morning', title: 'Morning' },
        { id: 'visit_evening', title: 'Evening' },
      ],
      'Visit Booking',
      'Tap one option',
      expect.any(Object),
    );
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('[Quick Replies] Morning | Evening'),
        }),
      }),
    );
  });

  test('POST /api/conversations/:id/messages rejects invalid payloads with 400', async () => {
    const { app, whatsappServiceMock, mockPrisma } = createConversationApp();

    const response = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ mode: 'document' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid message payload');
    expect(whatsappServiceMock.sendMessage).not.toHaveBeenCalled();
    expect(whatsappServiceMock.sendDocument).not.toHaveBeenCalled();
    expect(whatsappServiceMock.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  test('POST /api/conversations/:id/messages enforces assigned-agent boundary for sales agents', async () => {
    const { app, whatsappServiceMock, mockPrisma } = createConversationApp({
      role: 'sales_agent',
      assignedAgentId: 'user-999',
    });

    const response = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ mode: 'text', text: 'Blocked by assignment check' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Can only send messages for assigned conversations');
    expect(whatsappServiceMock.sendMessage).not.toHaveBeenCalled();
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });
});
