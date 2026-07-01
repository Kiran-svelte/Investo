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
        'I could not safely fetch your visit details just now, Raj. Our team is being notified, and I will only use confirmed visit information.',
      ),
    ).toBe(true);
  });

  test('shouldNotifyStaffForBuyerAiFailure includes visit-aware delay for staff transparency', () => {
    const visitAware = buildSafeBuyerFallback({
      activeVisit: {
        propertyName: 'Sunset Heights',
        scheduledAt: new Date('2026-06-17T04:30:00.000Z'),
        status: 'confirmed',
      },
    });
    expect(shouldNotifyStaffForBuyerAiFailure(visitAware)).toBe(true);
  });
});
