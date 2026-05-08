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

    expect(response.text).toContain('Great! Based on your interest');
    expect(response.detectedLanguage).toBe('en');
  });
});