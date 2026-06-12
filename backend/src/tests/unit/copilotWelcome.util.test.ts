/// <reference types="jest" />

import { buildCopilotWelcomeMessage } from '../../utils/copilotWelcome.util';

describe('copilotWelcome.util (fix.md issue 7)', () => {
  test('returns Hindi welcome when language is hi', () => {
    const message = buildCopilotWelcomeMessage('Ravi', 'Demo Realty', 'hi');
    expect(message).toContain('नमस्ते Ravi');
    expect(message).toContain('Demo Realty');
  });

  test('returns Kannada welcome when language is kn', () => {
    const message = buildCopilotWelcomeMessage('Priya', 'Lake Vista', 'kn');
    expect(message).toContain('ನಮಸ್ಕಾರ Priya');
  });
});
