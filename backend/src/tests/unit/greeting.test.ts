import { isCopilotGreeting, normalizeCopilotInboundText } from '../../utils/copilotGreeting.util';

describe('isCopilotGreeting', () => {
  it('matches common staff greetings', () => {
    expect(isCopilotGreeting('hi')).toBe(true);
    expect(isCopilotGreeting('Hello!')).toBe(true);
    expect(isCopilotGreeting('help')).toBe(true);
    expect(isCopilotGreeting('good morning')).toBe(true);
  });

  it('rejects long or action messages', () => {
    expect(isCopilotGreeting('visits on 6th june')).toBe(false);
    expect(isCopilotGreeting('a'.repeat(60))).toBe(false);
  });

  it('strips zero-width spaces', () => {
    expect(isCopilotGreeting('\u200bHi\u200b')).toBe(true);
    expect(normalizeCopilotInboundText('\u200bHi\u200b')).toBe('Hi');
  });
});
