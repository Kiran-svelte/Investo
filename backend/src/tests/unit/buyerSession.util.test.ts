/// <reference types="jest" />

import {
  BUYER_CONVERSATION_HISTORY_LIMIT,
  classifyBuyerSession,
  computeHasPriorOutbound,
} from '../../services/buyer/buyerSession.util';

describe('buyerSession.util', () => {
  it('computeHasPriorOutbound is false for customer-only history', () => {
    expect(
      computeHasPriorOutbound([
        { senderType: 'customer' },
        { senderType: 'customer' },
      ]),
    ).toBe(false);
  });

  it('computeHasPriorOutbound is true when ai or agent replied', () => {
    expect(computeHasPriorOutbound([{ senderType: 'customer' }, { senderType: 'ai' }])).toBe(
      true,
    );
    expect(
      computeHasPriorOutbound([{ senderType: 'customer' }, { senderType: 'agent' }]),
    ).toBe(true);
  });

  it('classifies first conversation vs returning greeting', () => {
    expect(
      classifyBuyerSession({ messageText: 'Hi', hasPriorOutbound: false }),
    ).toBe('first_conversation');
    expect(
      classifyBuyerSession({ messageText: 'Hello', hasPriorOutbound: true }),
    ).toBe('returning_greeting');
  });

  it('classifies returning pivot and /start', () => {
    expect(
      classifyBuyerSession({ messageText: 'Something new', hasPriorOutbound: true }),
    ).toBe('returning_pivot');
    expect(classifyBuyerSession({ messageText: '/start', hasPriorOutbound: true })).toBe(
      'fresh_restart',
    );
  });

  it('uses 30-message history limit constant per full.md PART II', () => {
    expect(BUYER_CONVERSATION_HISTORY_LIMIT).toBe(30);
  });
});
