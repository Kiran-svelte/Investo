/// <reference types="jest" />

function loadAiService(configOverride: any) {
  jest.resetModules();

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: configOverride,
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

  jest.doMock('../../services/propertyKnowledge.service', () => ({
    __esModule: true,
    searchPropertyKnowledge: jest.fn().mockResolvedValue([]),
    formatKnowledgeContextForPrompt: jest.fn(() => ''),
  }));

  let aiService: any;
  jest.isolateModules(() => {
    aiService = require('../../services/ai.service').aiService;
  });

  return aiService;
}

describe('AIService fallback behavior', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('falls back to the smart mock response when the configured provider fails', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('provider unavailable'));

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
      customerMessage: 'Hi, I am looking for a 2BHK apartment in Bangalore with a budget of 50 lakhs',
      conversationHistory: [],
      lead: {
        customerName: 'Rajesh Kumar',
        budgetMin: null,
        budgetMax: null,
        locationPreference: null,
        propertyType: null,
      },
      properties: [],
      aiSettings: {},
      companyName: 'Investo',
      conversationState: undefined,
    });

    expect(response.text).toContain('Welcome to *Investo*');
    expect(response.text).toContain('budget range');
    expect(response.detectedLanguage).toBe('en');
  });

  test('sends legal grounding rules in the LLM system prompt', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Grounded response\n###EXTRACT###\n{"language":"en"}',
            },
          },
        ],
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
      customerMessage: 'Do you have 3BHK with RERA details?',
      conversationHistory: [],
      lead: {
        customerName: 'Rajesh Kumar',
        budgetMin: null,
        budgetMax: null,
        locationPreference: null,
        propertyType: null,
      },
      properties: [
        {
          name: 'Palm Villa',
          status: 'available',
          locationArea: 'Whitefield',
          locationCity: 'Bengaluru',
          priceMin: 8500000,
          priceMax: 12500000,
          bedrooms: 3,
          propertyType: 'villa',
          amenities: ['Pool'],
        },
      ],
      aiSettings: {},
      companyName: 'Investo',
      conversationState: undefined,
    });

    const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    const systemPrompt = body.messages[0].content;

    expect(systemPrompt).toContain('LEGAL SAFETY');
    expect(systemPrompt).toContain('NEVER state prices, BHK, area, amenities, RERA, possession, discounts, ROI');
    expect(systemPrompt).toContain('If a fact is missing from the data blocks, say it is not in our current records');
    expect(systemPrompt).toContain('YOUR ROLE');
    expect(systemPrompt).toContain('AI LIMITS');
    expect(systemPrompt).toContain('Finalize or negotiate price');
  });
});
