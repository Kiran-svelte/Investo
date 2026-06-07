import {
  buildBuyerRapportReply,
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

  test('returning buyer Hi gets short ack without full welcome', () => {
    expect(isBuyerRapportMessage('Hi', { hasPriorOutbound: true })).toBe(true);
    expect(isReturningBuyerGreeting('Hi', { hasPriorOutbound: true })).toBe(true);
    const reply = buildBuyerRapportReply('Palm Realty', {
      isReturning: true,
      locationPreference: 'Whitefield',
    });
    expect(reply).toContain('Welcome back');
    expect(reply).toContain('Whitefield');
    expect(reply).not.toContain('Welcome to *Palm Realty*');
  });

  test('returning buyer "Something new" pivot is detected', () => {
    expect(isReturningBuyerPivotReply('Something new')).toBe(true);
    expect(isReturningBuyerPivotReply('new search')).toBe(true);
    expect(isReturningBuyerPivotReply('3 BHK Whitefield')).toBe(false);
    expect(buildReturningBuyerPivotReply('Palm Realty')).toContain('start fresh');
  });
});
