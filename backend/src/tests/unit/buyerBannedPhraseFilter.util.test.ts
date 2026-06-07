import { containsBannedBuyerPhrase } from '../../utils/buyerBannedPhraseFilter.util';

describe('buyerBannedPhraseFilter.util', () => {
  test('blocks invented connection errors', () => {
    expect(
      containsBannedBuyerPhrase('I had a brief connection issue, but your visit is on record.'),
    ).toBe(true);
  });

  test('blocks mid-conversation dream-property welcome', () => {
    expect(
      containsBannedBuyerPhrase(
        'Hello! How can I help you find your dream property today?',
        { hasPriorOutbound: true },
      ),
    ).toBe(true);
  });

  test('allows deterministic Welcome back from H2 (not banned without visit_booking stage)', () => {
    expect(
      containsBannedBuyerPhrase('Welcome back! Still looking at Whitefield?', {
        hasPriorOutbound: true,
        stage: 'rapport',
      }),
    ).toBe(false);
  });

  test('blocks budget bleed during visit_booking', () => {
    expect(
      containsBannedBuyerPhrase(
        'Hi! Thanks for messaging Palm. Could you share your preferred area, budget, and BHK?',
        { stage: 'visit_booking', hasPriorOutbound: true },
      ),
    ).toBe(true);
  });

  test('blocks numbered capability menus', () => {
    expect(containsBannedBuyerPhrase('Here is how I can help:\n1. Answer questions\n2. Book visits')).toBe(true);
  });
});
