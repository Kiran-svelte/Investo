/// <reference types="jest" />

import {
  buildGroundedNumberAllowlist,
  stripUngroundedClaims,
} from '../../services/groundingGuard.service';

describe('groundingGuard.service', () => {
  test('allows prices present in property data', () => {
    const allowlist = buildGroundedNumberAllowlist([
      { priceMin: 5_000_000, priceMax: 8_000_000, bedrooms: 2 },
    ]);
    const { text, guardApplied } = stripUngroundedClaims(
      'This 2BHK starts at ₹50.0L in Whitefield.',
      allowlist,
    );
    expect(guardApplied).toBe(false);
    expect(text).toContain('₹');
  });

  test('softens ungrounded discount percentage', () => {
    const allowlist = buildGroundedNumberAllowlist([{ priceMin: 5_000_000 }]);
    const { text, guardApplied } = stripUngroundedClaims(
      'Limited time 15% off if you book today!',
      allowlist,
    );
    expect(guardApplied).toBe(true);
    expect(text.toLowerCase()).toContain('promotional offer');
  });
});
