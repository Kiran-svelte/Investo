/// <reference types="jest" />

const mockIncrementOpsMetric = jest.fn();

function loadAiService(configOverride: Record<string, unknown>) {
  jest.resetModules();

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: configOverride,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  jest.doMock('../../services/opsMetrics.service', () => ({
    incrementOpsMetric: (...args: unknown[]) => mockIncrementOpsMetric(...args),
  }));

  jest.doMock('../../services/propertyKnowledge.service', () => ({
    __esModule: true,
    searchPropertyKnowledge: jest.fn().mockResolvedValue([]),
    formatKnowledgeContextForPrompt: jest.fn(() => ''),
    getPropertyKnowledgeForProperty: jest.fn().mockResolvedValue([]),
  }));

  jest.doMock('../../services/clientMemory.service', () => ({
    searchClientMemory: jest.fn().mockResolvedValue([]),
    formatClientMemoryForPrompt: jest.fn(() => ''),
  }));

  jest.doMock('../../services/unifiedMemory.service', () => ({
    buildUnifiedMemoryContextBlock: jest.fn().mockResolvedValue({
      leadMemoryBlock: '',
      conversationContextBlock: '',
    }),
  }));

  jest.doMock('../../services/buyerVisitQuery.service', () => ({
    isBuyerVisitStatusQuery: jest.fn().mockReturnValue(false),
    buildBuyerVisitStatusReply: jest.fn(),
  }));

  let aiService: {
    generateResponse: (req: Record<string, unknown>) => Promise<{
      text: string;
      nextAction?: { action: string; promptModifiers?: string[] };
    }>;
  };
  jest.isolateModules(() => {
    aiService = require('../../services/ai.service').aiService;
  });

  return aiService!;
}

describe('ai.service buyer path (chunk 07)', () => {
  jest.setTimeout(15_000);

  afterEach(() => {
    jest.restoreAllMocks();
    mockIncrementOpsMetric.mockClear();
  });

  test('increments ai_replies counter on successful provider response', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"reply":"Sure, I can help with that."}' } }],
      }),
    });

    const aiService = loadAiService({
      db: { url: 'postgresql://test', ssl: false },
      ai: {
        provider: 'openai',
        openaiApiKey: 'test-openai-key',
        openaiModel: 'gpt-4o',
        kimiApiKey: '',
        claudeApiKey: '',
      },
    });

    await aiService.generateResponse({
      customerMessage: 'Tell me more about Sunrise Apartments',
      conversationHistory: [{ senderType: 'customer', content: 'Hi' }],
      lead: {
        id: 'lead-1',
        customerName: 'Raj',
        budgetMin: null,
        budgetMax: null,
        locationPreference: null,
        propertyType: null,
        status: 'contacted',
      },
      properties: [{
        id: 'p1',
        name: 'Sunrise',
        status: 'available',
        locationArea: 'A',
        locationCity: 'B',
        priceMin: 1,
        priceMax: 2,
        bedrooms: 2,
        propertyType: 'apartment',
        amenities: [],
      }],
      aiSettings: {},
      companyName: 'Investo',
      companyId: 'co-1',
      conversationState: undefined,
    });

    expect(mockIncrementOpsMetric).toHaveBeenCalledWith('ai_replies');
  });

  test('injects objection playbook modifiers when policy brain selects handle_objection', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockImplementation(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}');
      const systemPrompt = body.messages?.[0]?.content ?? '';
      expect(systemPrompt).toContain('OBJECTION DETECTED: price_too_high');
      expect(systemPrompt).toContain('EMPATHY FIRST:');
      expect(systemPrompt).toContain('FALLBACK:');
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"reply":"I understand budget matters."}' } }],
        }),
      };
    });

    const aiService = loadAiService({
      db: { url: 'postgresql://test', ssl: false },
      ai: {
        provider: 'openai',
        openaiApiKey: 'test-openai-key',
        openaiModel: 'gpt-4o',
        kimiApiKey: '',
        claudeApiKey: '',
      },
    });

    const response = await aiService.generateResponse({
      customerMessage: 'This property is too expensive for our budget',
      conversationHistory: [],
      lead: {
        id: 'lead-1',
        customerName: 'Raj',
        budgetMin: null,
        budgetMax: null,
        locationPreference: null,
        propertyType: null,
        status: 'contacted',
      },
      properties: [],
      aiSettings: {},
      companyName: 'Investo',
      companyId: 'co-1',
      conversationState: {
        stage: 'shortlist',
        previousStage: null,
        messageCount: 2,
        stageEnteredAt: new Date(),
        commitments: {
          budgetConfirmed: false,
          locationConfirmed: false,
          propertyTypeConfirmed: false,
          timelineConfirmed: false,
          propertyInterestShown: false,
          visitSlotDiscussed: false,
          visitSlotConfirmed: false,
          contactInfoShared: false,
        },
        objectionCount: 0,
        lastObjectionType: null,
        consecutiveObjections: 0,
        urgencyScore: 3,
        valueScore: 4,
        escalationReason: null,
        selectedPropertyId: null,
        recommendedProperties: [],
        proposedVisitTime: null,
      },
    });

    expect(response.text).toContain('budget');
  });
});
