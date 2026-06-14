/// <reference types="jest" />

jest.setTimeout(30000);

const mockOrchestrateWhatsAppBuyerTurn = jest.fn();

const mockPrisma = {
  company: { findMany: jest.fn(), findUnique: jest.fn() },
  lead: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
  conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  message: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  inboundWhatsappDedup: { create: jest.fn() },
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
      provider: 'meta',
      phoneNumberId: '',
      accessToken: '',
      verifyToken: '',
      apiUrl: 'https://graph.facebook.com/v18.0',
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

jest.mock('../../services/customerVisitBooking.service', () => ({
  __esModule: true,
  tryCommitCustomerVisitBooking: jest.fn().mockResolvedValue({ committed: false }),
}));

jest.mock('../../services/messagePolish.service', () => ({
  __esModule: true,
  polishOutboundMessage: jest.fn(async ({ rawText }: { rawText: string }) => ({
    text: rawText,
    mode: 'unchanged',
  })),
}));

jest.mock('../../services/brochureDelivery.service', () => ({
  __esModule: true,
  deliverBrochuresForAiTurn: jest.fn().mockResolvedValue({ cleanedText: 'Hi Rajesh! Here are a few options...' }),
}));

jest.mock('../../services/inboundWhatsAppRouting.service', () => ({
  __esModule: true,
  routeCompanyScopedInbound: jest.fn().mockResolvedValue({
    handled: false,
    route: { kind: 'customer' },
  }),
}));

jest.mock('../../services/buyer-memory-extract.service', () => ({
  __esModule: true,
  extractAndPatchLeadMemory: jest.fn().mockResolvedValue(undefined),
  inferBuyerWorkflowIdFromMessage: jest.fn().mockReturnValue(null),
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

jest.mock('../../services/inboundMessageGuard.service', () => ({
  __esModule: true,
  claimInboundMessageFull: jest.fn().mockResolvedValue(true),
  claimCustomerInboundFingerprint: jest.fn().mockResolvedValue(true),
  claimCustomerProcessingTurn: jest.fn().mockResolvedValue(true),
  releaseCustomerProcessingTurn: jest.fn().mockResolvedValue(undefined),
  releaseInboundMessageFull: jest.fn().mockResolvedValue(undefined),
  claimOutboundAiReply: jest.fn().mockResolvedValue(true),
  releaseOutboundAiReply: jest.fn().mockResolvedValue(undefined),
  inboundCustomerMessageLacksAiReply: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../services/whatsappPresence.service', () => ({
  __esModule: true,
  simulateHumanReplyPacing: jest.fn().mockResolvedValue(undefined),
  startTypingDuringProcessing: jest.fn().mockReturnValue({ stop: jest.fn() }),
}));

jest.mock('../../services/whatsapp/whatsappTurnOrchestrator.service', () => ({
  __esModule: true,
  orchestrateWhatsAppBuyerTurn: (...args: unknown[]) => mockOrchestrateWhatsAppBuyerTurn(...args),
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
            provider: 'meta',
                  },
        },
      },
    ]);
    mockPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Investo Platform',
      settings: {
        whatsapp: {
          provider: 'meta',
              },
      },
    });

    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      companyId: 'company-1',
      customerName: 'Rajesh Kumar',
      phone: '+919876543210',
      status: 'contacted',
      language: 'en',
      assignedAgentId: null,
    });
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      companyId: 'company-1',
      metadata: {},
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
    mockPrisma.message.findFirst.mockResolvedValue(null);
    mockPrisma.inboundWhatsappDedup.create.mockResolvedValue({ id: 'dedup-1' });
    mockPrisma.message.create.mockResolvedValue({ id: 'message-1' });
    mockPrisma.message.update.mockResolvedValue({ id: 'message-1' });
    mockPrisma.message.updateMany.mockResolvedValue({ count: 0 });
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

    mockOrchestrateWhatsAppBuyerTurn.mockImplementation(async (ctx: { input: { leadId: string } }) => {
      await mockPrisma.lead.update({
        where: { id: ctx.input.leadId },
        data: {
          budgetMax: 5000000,
          locationPreference: 'Bangalore',
          propertyType: 'apartment',
        },
      });
      return {
        audience: 'buyer',
        handled: true,
        terminal: true,
        text: 'Hi Rajesh! Here are a few options...',
      };
    });
  });

  test('normalizes extracted property type before saving and still replies', async () => {
    const service = new WhatsAppService();
    jest.spyOn(service as any, 'sendMessage').mockResolvedValue(true);

    const result = await service.handleIncomingMessage({
      provider: 'meta',
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
