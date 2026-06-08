/// <reference types="jest" />

import { polishOutboundMessage } from '../../services/messagePolish.service';

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    ai: { openaiApiKey: '', kimiApiKey: '' },
  },
}));

describe('messagePolish.service', () => {
  test('deterministic polish strips internal meta footers', async () => {
    const raw =
      'Hello!\n\n—\nConfidence: High\nSources: Palmvilla\nReply WRONG if any info is incorrect.';
    const result = await polishOutboundMessage({ rawText: raw, channel: 'whatsapp' });
    expect(result.text).toBe('Hello!');
    expect(result.text).not.toContain('Confidence');
  });

  test('deterministic polish normalizes markdown and trims length', async () => {
    const long = 'Hello '.repeat(400);
    const result = await polishOutboundMessage({
      rawText: `**Bold title**\n\n${long}`,
      channel: 'whatsapp',
      maxLength: 200,
    });
    expect(result.mode).toBe('deterministic');
    expect(result.text.length).toBeLessThanOrEqual(203);
    expect(result.text).toContain('*Bold title*');
  });

  test('LLM polish fails open to deterministic text after 3s timeout', async () => {
    jest.resetModules();
    process.env.POLISH_USE_LLM = '1';
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        ai: { openaiApiKey: 'test-key', kimiApiKey: '', openaiModel: 'gpt-4o', kimiApiBaseUrl: '', kimi25Model: '' },
      },
    }));
    jest.doMock('../../config/logger', () => ({
      __esModule: true,
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
      () => new Promise(() => undefined),
    );

    const { polishOutboundMessage: polishWithTimeout } = await import('../../services/messagePolish.service');
    const started = Date.now();
    const result = await polishWithTimeout({
      rawText: 'Hello buyer',
      channel: 'whatsapp',
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.mode).toBe('deterministic');
    expect(result.text).toBe('Hello buyer');
    delete process.env.POLISH_USE_LLM;
  });
});
