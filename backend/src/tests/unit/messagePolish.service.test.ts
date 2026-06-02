/// <reference types="jest" />

import { polishOutboundMessage } from '../../services/messagePolish.service';

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    ai: { openaiApiKey: '', kimiApiKey: '' },
  },
}));

describe('messagePolish.service', () => {
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
});
