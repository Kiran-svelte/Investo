import {
  detectBuyerButtonSituation,
  resolveButtonsForBuyerSituation,
  resolveSituationBuyerButtons,
} from '../../utils/buyerSituationButtons.util';

const APARTMENT_ONLY_FILTERS = [
  { id: 'filter-apartment', title: 'Apartments' },
  { id: 'filter-2bhk', title: '2 BHK' },
  { id: 'call-me', title: 'Call Me' },
];

describe('buyerSituationButtons.util', () => {
  test('catalog empty reply gets company-specific filter buttons', () => {
    const situation = detectBuyerButtonSituation({
      stage: 'qualify',
      outboundText: "I couldn't find a *4 BHK* in our current catalog.\n\nTap a filter below.",
    });
    expect(situation).toBe('catalog_empty');
    const buttons = resolveButtonsForBuyerSituation(situation, {
      stage: 'qualify',
      outboundText: "I couldn't find a *4 BHK*",
      browseFilters: [
        { id: 'filter-apartment', title: 'Apartments' },
        { id: 'filter-2bhk', title: '2 BHK' },
        { id: 'filter-3bhk', title: '3 BHK' },
      ],
    });
    expect(buttons?.map((b) => b.id)).toEqual(['filter-apartment', 'filter-2bhk', 'filter-3bhk']);
    expect(buttons?.map((b) => b.id)).not.toContain('filter-villa');
  });

  test('discovery welcome never shows villa when company has apartments only', () => {
    const buttons = resolveSituationBuyerButtons({
      stage: 'rapport',
      outboundText: 'Hello! Welcome to *Palm Realty*.',
      browseFilters: APARTMENT_ONLY_FILTERS,
    });
    expect(buttons?.map((b) => b.id)).toEqual(['filter-apartment', 'filter-2bhk', 'call-me']);
    expect(buttons?.map((b) => b.id)).not.toContain('filter-villa');
  });

  test('single property focus gets book/details/call', () => {
    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Lake Vista in Whitefield starts from ₹1.2Cr.',
      propertyId: 'prop-lake',
      properties: [{ id: 'prop-lake', name: 'Lake Vista' }],
    });
    expect(buttons?.map((b) => b.id)).toEqual([
      'book-visit-prop-lake',
      'more-info-prop-lake',
      'call-me',
    ]);
  });

  test('price reply gets EMI path', () => {
    const situation = detectBuyerButtonSituation({
      stage: 'shortlist',
      outboundText: 'Pricing for Sunset Heights is ₹95L – ₹1.1Cr.',
      propertyId: 'p1',
    });
    expect(situation).toBe('price_discussed');
    expect(resolveButtonsForBuyerSituation(situation, {
      stage: 'shortlist',
      outboundText: 'Pricing for Sunset Heights is ₹95L – ₹1.1Cr.',
      propertyId: 'p1',
    })?.map((b) => b.id)).toContain('emi-calculator');
  });

  test('active visit confirmed gets reschedule buttons', () => {
    const situation = detectBuyerButtonSituation({
      stage: 'confirmation',
      outboundText: 'Your visit is confirmed for Saturday.',
      hasActiveVisit: true,
      visitStatus: 'confirmed',
      propertyId: 'p1',
    });
    expect(situation).toBe('visit_confirmed');
  });
});
