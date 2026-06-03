/// <reference types="jest" />

const mockPrisma = {
  company: { findMany: jest.fn() },
  lead: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
  conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  message: { create: jest.fn(), findMany: jest.fn() },
  notification: { create: jest.fn() },
  aiSetting: { findUnique: jest.fn() },
  property: { findMany: jest.fn(), findUnique: jest.fn() },
  user: { findMany: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    env: 'development',
    whatsapp: {
      provider: 'greenapi',
      phoneNumberId: '',
      accessToken: '',
      verifyToken: '',
      apiUrl: 'https://api.green-api.com',
      allowGreenapiInProd: true,
    },
    greenapi: {
      apiUrl: 'https://api.green-api.com',
      idInstance: '7107584520',
      apiTokenInstance: 'token',
      webhookUrlToken: 'token',
    },
    ai: {
      provider: 'openai',
      openaiApiKey: 'test-openai-key',
      openaiModel: 'gpt-4o',
      kimiApiKey: '',
      claudeApiKey: '',
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

jest.mock('../../services/conversionEngine.service', () => ({
  __esModule: true,
  buildConversionContext: jest.fn().mockResolvedValue({
    exactPropertyIds: [],
    alternativePropertyIds: [],
    promptBlock: '',
    emiSnippet: null,
  }),
}));

jest.mock('../../services/neverSayNoEngine.service', () => ({
  __esModule: true,
  buildNeverSayNoContext: jest.fn().mockResolvedValue({
    promptBlock: '',
    exactPropertyIds: [],
    alternativePropertyIds: [],
    fallbackCta: 'Reply with your budget and area.',
    hasInventoryAlternatives: false,
  }),
}));

jest.mock('../../services/inboundWhatsAppRouting.service', () => ({
  __esModule: true,
  routeCompanyScopedInbound: jest.fn().mockResolvedValue({
    handled: false,
    route: { kind: 'customer' },
  }),
}));

jest.mock('../../services/socket.service', () => ({
  __esModule: true,
  socketService: {
    emitToCompany: jest.fn().mockReturnValue(true),
  },
  SOCKET_EVENTS: {
    CONVERSATION_UPDATED: 'conversation.updated',
    MESSAGE_NEW: 'message.new',
  },
}));

import { aiService } from '../../services/ai.service';
import { WhatsAppService } from '../../services/whatsapp.service';

describe('WhatsAppService AI response processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.company.findMany.mockResolvedValue([
      {
        id: 'company-1',
        name: 'Investo Platform',
        settings: {
          whatsapp: {
            provider: 'greenapi',
            greenapi: {
              idInstance: '7107584520',
              apiTokenInstance: 'token',
              webhookUrlToken: 'token',
            },
          },
        },
      },
    ]);

    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      companyId: 'company-1',
      customerName: 'Rajesh Kumar',
      phone: '+919876543210',
      status: 'contacted',
      language: 'en',
      assignedAgentId: null,
    });

    mockPrisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      companyId: 'company-1',
      leadId: 'lead-1',
      status: 'ai_active',
      aiEnabled: true,
      language: 'en',
      stage: 'qualify',
      stageEnteredAt: new Date(),
      stageMessageCount: 1,
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
    });

    mockPrisma.message.findMany.mockResolvedValue([
      { senderType: 'customer', content: 'I want a 2BHK under 50 lakhs' },
    ]);

    mockPrisma.aiSetting.findUnique.mockResolvedValue({ responseTone: 'friendly' });
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.property.findMany.mockResolvedValue([]);
    mockPrisma.message.create.mockResolvedValue({ id: 'message-1' });
    mockPrisma.lead.update.mockResolvedValue({ id: 'lead-1' });
    mockPrisma.conversation.update.mockResolvedValue({ id: 'conv-1' });

    (aiService.generateResponse as jest.Mock).mockResolvedValue({
      text: 'Hi Rajesh! Here are a few options...',
      detectedLanguage: 'en',
      extractedInfo: {
        budget_min: 0,
        budget_max: 5000000,
        location_preference: 'Bangalore',
        property_type: '2BHK apartment',
      },
      newState: {
        stage: 'shortlist',
        messageCount: 2,
        commitments: {},
        objectionCount: 0,
        consecutiveObjections: 0,
        urgencyScore: 5,
        valueScore: 5,
        recommendedProperties: [],
      },
      nextAction: { action: 'advance_stage' },
    });
  });

  test('normalizes extracted property type before saving and still replies', async () => {
    const service = new WhatsAppService();
    jest.spyOn(service as any, 'sendMessage').mockResolvedValue(true);

    const result = await service.handleIncomingMessage({
      provider: 'greenapi',
      phoneNumberId: '7107584520',
      customerPhone: '916363062930',
      customerName: 'Rajesh Kumar',
      messageText: 'I want a 2BHK under 50 lakhs',
      messageId: 'msg-1',
    });

    expect(mockPrisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: expect.objectContaining({
          budgetMax: 5000000,
          locationPreference: 'Bangalore',
          propertyType: 'apartment',
        }),
      }),
    );
    expect(result.status).toBe('processed');
    expect(service.sendMessage).toHaveBeenCalled();
  });
});