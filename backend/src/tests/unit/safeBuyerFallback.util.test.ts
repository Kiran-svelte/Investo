import {
  buildSafeBuyerFallback,
  isGenericSafeBuyerFallback,
  shouldNotifyStaffForBuyerAiFailure,
} from '../../utils/safeBuyerFallback.util';

describe('safeBuyerFallback.util', () => {
  test('isGenericSafeBuyerFallback detects standard failure copy', () => {
    const text = buildSafeBuyerFallback();
    expect(isGenericSafeBuyerFallback(text)).toBe(true);
  });

  test('shouldNotifyStaffForBuyerAiFailure covers generic and brief-issue replies', () => {
    expect(shouldNotifyStaffForBuyerAiFailure(buildSafeBuyerFallback())).toBe(true);
    expect(shouldNotifyStaffForBuyerAiFailure('Sorry, I had a brief issue. Could you repeat that?')).toBe(true);
    expect(
      shouldNotifyStaffForBuyerAiFailure(
        "I couldn't fetch your visit details just now, Raj. Please try again in a moment, or type *Talk to agent* for help.",
      ),
    ).toBe(true);
  });

  test('shouldNotifyStaffForBuyerAiFailure skips visit-aware delay message', () => {
    const visitAware = buildSafeBuyerFallback({
      activeVisit: {
        propertyName: 'Sunset Heights',
        scheduledAt: new Date('2026-06-17T04:30:00.000Z'),
        status: 'confirmed',
      },
    });
    expect(shouldNotifyStaffForBuyerAiFailure(visitAware)).toBe(false);
  });
});
