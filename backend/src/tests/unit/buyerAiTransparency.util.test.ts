import {
  detectBuyerAiStaffAssist,
  isGenericSafeBuyerFallback,
  shouldNotifyStaffForBuyerAiFailure,
} from '../../utils/buyerAiTransparency.util';
import { buildSafeBuyerFallback } from '../../utils/safeBuyerFallback.util';

describe('buyerAiTransparency.util', () => {
  test('shouldNotifyStaffForBuyerAiFailure covers generic and brief-issue replies', () => {
    expect(shouldNotifyStaffForBuyerAiFailure(buildSafeBuyerFallback())).toBe(true);
    expect(shouldNotifyStaffForBuyerAiFailure('Sorry, I had a brief issue. Could you repeat that?')).toBe(true);
    expect(
      shouldNotifyStaffForBuyerAiFailure(
        'I could not safely fetch your visit details just now. Our team is being notified, and I will only use confirmed visit information.',
      ),
    ).toBe(true);
  });

  test('shouldNotifyStaffForBuyerAiFailure includes visit-aware delay (enterprise transparency)', () => {
    const visitAware = buildSafeBuyerFallback({
      activeVisit: {
        propertyName: 'Sunrise Towers',
        scheduledAt: new Date('2026-06-20T10:00:00Z'),
        status: 'confirmed',
      },
    });
    expect(shouldNotifyStaffForBuyerAiFailure(visitAware)).toBe(true);
  });

  test('shouldNotifyStaffForBuyerAiFailure skips normal browse clarifications', () => {
    expect(
      shouldNotifyStaffForBuyerAiFailure("We couldn't find a *3 BHK* in Whitefield right now. View Listings?"),
    ).toBe(false);
  });

  test('detectBuyerAiStaffAssist honors explicit TurnResult staffAssist reason', () => {
    const result = detectBuyerAiStaffAssist({
      outboundText: 'anything',
      explicitReason: 'escalation_request',
      explicitSummary: 'Customer asked for human',
    });
    expect(result?.reason).toBe('escalation_request');
    expect(result?.summary).toBe('Customer asked for human');
  });

  test('isGenericSafeBuyerFallback detects generic apology', () => {
    expect(isGenericSafeBuyerFallback(buildSafeBuyerFallback())).toBe(true);
  });
});
