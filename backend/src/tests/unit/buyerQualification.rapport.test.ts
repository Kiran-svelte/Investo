import {
  buildBuyerRapportReply,
  buildReturningBuyerWelcomeReply,
  buildReturningBuyerPivotReply,
  isBuyerRapportMessage,
  isReturningBuyerGreeting,
  isReturningBuyerPivotReply,
} from '../../services/buyerQualification.service';

describe('buyerQualification returning buyer rapport', () => {
  test('stranger Hi triggers full welcome', () => {
    expect(isBuyerRapportMessage('Hi', { hasPriorOutbound: false })).toBe(true);
    expect(isReturningBuyerGreeting('Hi', { hasPriorOutbound: false })).toBe(false);
    expect(buildBuyerRapportReply('Palm Realty')).toContain('Welcome to *Palm Realty*');
  });

  test('returning buyer Hi gets enriched welcome', () => {
    expect(isBuyerRapportMessage('Hi', { hasPriorOutbound: true })).toBe(true);
    expect(isReturningBuyerGreeting('Hi', { hasPriorOutbound: true })).toBe(true);
    const reply = buildReturningBuyerWelcomeReply({
      companyName: 'Palm Realty',
      locationPreference: 'Whitefield',
      liveCtx: {
        leadStatus: 'new',
        activeVisit: null,
        recentCompletedVisit: null,
        recentCancelledVisit: null,
        activeCall: null,
      },
    });
    expect(reply).toContain('Welcome to *Palm Realty*');
    expect(reply).toContain('Whitefield');
  });

  test('returning buyer "Something new" pivot is detected', () => {
    expect(isReturningBuyerPivotReply('Something new')).toBe(true);
    expect(isReturningBuyerPivotReply('new search')).toBe(true);
    expect(isReturningBuyerPivotReply('3 BHK Whitefield')).toBe(false);
    expect(buildReturningBuyerPivotReply('Palm Realty')).toContain('start fresh');
  });
});
