import {
  formatAlternativesForPrompt,
  type AlternativeTier,
} from '../../services/alternativeInventory.service';

describe('alternativeInventory.service', () => {
  test('formatAlternativesForPrompt includes never-say-no rules and waitlist when empty', () => {
    const text = formatAlternativesForPrompt([], []);
    expect(text).toContain('NEVER-SAY-NO');
    expect(text).toContain('waitlist');
  });

  test('formatAlternativesForPrompt includes tier hints', () => {
    const tiers: AlternativeTier[] = [
      {
        tier: 'upsell_bhk',
        properties: [
          {
            id: '1',
            name: 'Big Villa',
            locationArea: 'Koramangala',
            locationCity: 'Bangalore',
            bedrooms: 3,
            propertyType: 'apartment',
            priceMin: 9000000,
            priceMax: 12000000,
          } as any,
        ],
        messageHint: 'Try 3 BHK for more space',
      },
    ];
    const text = formatAlternativesForPrompt([], tiers);
    expect(text).toContain('Try 3 BHK');
    expect(text).toContain('Big Villa');
  });
});
