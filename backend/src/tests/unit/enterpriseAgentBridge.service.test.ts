/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    enterpriseAgent: {
      enabled: false,
      mode: 'augment',
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

import config from '../../config';
import { aiService } from '../../services/ai.service';
import { runEnterpriseAgent } from '../../services/enterpriseAgentBridge';

describe('enterpriseAgentBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).enterpriseAgent.enabled = false;
  });

  test('returns skipped when disabled', async () => {
    const res = await runEnterpriseAgent({ phone: '+919999999999', message: 'hi' });
    expect(res).toEqual({ skipped: true });
    expect((aiService.generateResponse as jest.Mock)).not.toHaveBeenCalled();
  });

  test('calls aiService when enabled', async () => {
    (config as any).enterpriseAgent.enabled = true;
    (aiService.generateResponse as jest.Mock).mockResolvedValue({ text: 'hello', detectedLanguage: 'en' });

    const res = await runEnterpriseAgent({ phone: '+919999999999', message: 'Need 2bhk in Bangalore' });

    expect(aiService.generateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        customerMessage: 'Need 2bhk in Bangalore',
      }),
    );
    expect(res).toEqual({
      skipped: false,
      ok: true,
      data: { text: 'hello', detectedLanguage: 'en' },
    });
  });
});
