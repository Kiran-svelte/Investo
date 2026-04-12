/// <reference types="jest" />

const mockPrisma = {
  company: {
    findMany: jest.fn(),
  },
  lead: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  },
  conversation: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  message: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
  aiSetting: {
    findUnique: jest.fn(),
  },
  property: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
};

const mockEmitToCompany = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    whatsapp: {
      phoneNumberId: 'global-pnid',
      accessToken: 'global-token',
      verifyToken: 'verify-token',
      apiUrl: 'https://graph.facebook.com/v17.0',
    },
  },
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

jest.mock('../../services/ai.service', () => ({
  __esModule: true,
  aiService: {
    generateResponse: jest.fn(),
  },
}));

jest.mock('../../services/socket.service', () => ({
  __esModule: true,
  socketService: {
    emitToCompany: mockEmitToCompany,
  },
  SOCKET_EVENTS: {
    CONVERSATION_UPDATED: 'conversation.updated',
  },
}));

import { WhatsAppService } from '../../services/whatsapp.service';
import logger from '../../config/logger';

function safeStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function expectNoRawPhoneInLoggerMetadata(): void {
  const forbidden = ['919999999999', '+919999999999'];
  const log = logger as any;
  const calls: any[][] = [
    ...(log.info?.mock?.calls ?? []),
    ...(log.warn?.mock?.calls ?? []),
    ...(log.error?.mock?.calls ?? []),
    ...(log.debug?.mock?.calls ?? []),
  ];

  for (const call of calls) {
    const metaArgs = call.slice(1);
    for (const meta of metaArgs) {
      const serialized = safeStringify(meta);
      for (const raw of forbidden) {
        expect(serialized).not.toContain(raw);
      }
    }
  }
}

describe('WhatsAppService inbound operational behavior', () => {
  let service: WhatsAppService;

  const company = {
    id: 'company-1',
    name: 'Investo Realty',
    whatsappPhone: null,
    settings: {
      whatsapp: {
        phoneNumberId: 'pnid-1',
        accessToken: 'company-token',
        verifyToken: 'company-verify',
      },
    },
  };

  const lead = {
    id: 'lead-1',
    companyId: 'company-1',
    customerName: 'A User',
    phone: '+919999999999',
    status: 'contacted',
    language: 'en',
    assignedAgentId: null,
  };

  const conversation = {
    id: 'conv-1',
    companyId: 'company-1',
    leadId: 'lead-1',
    status: 'agent_active',
    aiEnabled: false,
    stage: 'rapport',
    stageEnteredAt: new Date('2026-04-08T10:00:00.000Z'),
    stageMessageCount: 2,
    commitments: {},
    objectionCount: 0,
    lastObjectionType: null,
    consecutiveObjections: 0,
    urgencyScore: 5,
    valueScore: 5,
    escalationReason: null,
    recommendedPropertyIds: [],
    selectedPropertyId: null,
    proposedVisitTime: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WhatsAppService();

    mockPrisma.company.findMany.mockResolvedValue([company]);
    mockPrisma.lead.findFirst.mockResolvedValue(lead);
    mockPrisma.conversation.findFirst.mockResolvedValue(conversation);
    mockPrisma.message.create.mockResolvedValue({ id: 'message-1' });
    mockPrisma.lead.update.mockResolvedValue({ id: lead.id });
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1' });
    mockEmitToCompany.mockReturnValue(true);
  });

  afterEach(() => {
    expectNoRawPhoneInLoggerMetadata();
  });

  it('persists inbound message and updates lead contact details', async () => {
    const result = await service.handleIncomingMessage({
      phoneNumberId: 'pnid-1',
      customerPhone: '+919999999999',
      customerName: 'A User',
      messageText: 'Hello from WhatsApp',
      messageId: 'wamid-1',
    });

    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        senderType: 'customer',
        content: 'Hello from WhatsApp',
        whatsappMessageId: 'wamid-1',
      }),
    });

    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { lastContactAt: expect.any(Date) },
    });

    expect(mockEmitToCompany).toHaveBeenCalledWith(
      'company-1',
      'conversation.updated',
      expect.objectContaining({
        conversationId: 'conv-1',
        leadId: 'lead-1',
        trigger: 'customer_message',
      }),
    );

    expect(result.status).toBe('processed');
    expect(result.propagation).toEqual({ status: 'success' });
  });

  it('surfaces propagation failure when socket emission is unavailable', async () => {
    mockEmitToCompany.mockReturnValue(false);

    const result = await service.handleIncomingMessage({
      phoneNumberId: 'pnid-1',
      customerPhone: '+919999999999',
      customerName: 'A User',
      messageText: 'Need details',
      messageId: 'wamid-2',
    });

    expect(mockEmitToCompany).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('processed');
    expect(result.propagation).toEqual({
      status: 'failed',
      reason: 'socket_unavailable',
    });
  });

  it('surfaces propagation failure when socket emission throws', async () => {
    mockEmitToCompany.mockImplementation(() => {
      throw new Error('socket exploded');
    });

    const result = await service.handleIncomingMessage({
      phoneNumberId: 'pnid-1',
      customerPhone: '+919999999999',
      customerName: 'A User',
      messageText: 'Are you there?',
      messageId: 'wamid-3',
    });

    expect(mockEmitToCompany).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('processed');
    expect(result.propagation).toEqual({
      status: 'failed',
      reason: 'socket_emit_exception',
    });
  });
});
