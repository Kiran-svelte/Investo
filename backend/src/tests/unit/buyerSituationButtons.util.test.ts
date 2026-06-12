import {
  detectBuyerButtonSituation,
  resolveButtonsForBuyerSituation,
  resolveSituationBuyerButtons,
} from '../../utils/buyerSituationButtons.util';

describe('buyerSituationButtons.util', () => {
  test('catalog empty reply gets filter buttons', () => {
    const situation = detectBuyerButtonSituation({
      stage: 'qualify',
      outboundText: "I couldn't find a *4 BHK* in our current catalog.\n\nTap a filter below.",
    });
    expect(situation).toBe('catalog_empty');
    const buttons = resolveButtonsForBuyerSituation(situation, {
      stage: 'qualify',
      outboundText: "I couldn't find a *4 BHK*",
    });
    expect(buttons?.map((b) => b.id)).toEqual(['filter-apartment', 'filter-villa', 'filter-4bhk']);
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
