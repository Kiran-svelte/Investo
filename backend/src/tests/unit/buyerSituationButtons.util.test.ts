import {
  detectBuyerButtonSituation,
  resolveButtonsForBuyerSituation,
  resolveSituationBuyerButtons,
} from '../../utils/buyerSituationButtons.util';
import config from '../../config';

const APARTMENT_ONLY_FILTERS = [
  { id: 'filter-apartment', title: 'Apartments' },
  { id: 'filter-2bhk', title: '2 BHK' },
  { id: 'call-me', title: 'Call Me' },
];

describe('buyerSituationButtons.util', () => {
  const originalButtonScopeValidate = config.features.buttonScopeValidate;

  afterEach(() => {
    config.features.buttonScopeValidate = originalButtonScopeValidate;
  });

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

  test('single property focus gets book, view listing, and browse', () => {
    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Lake Vista in Whitefield starts from ₹1.2Cr.',
      propertyId: 'prop-lake',
      properties: [{ id: 'prop-lake', name: 'Lake Vista' }],
    });
    expect(buttons?.map((b) => b.id)).toEqual([
      'book-visit-prop-lake',
      'more-info-prop-lake',
      'browse-projects',
    ]);
  });

  test('single property focus shows Location only when that property has verified location data', () => {
    const withoutLocation = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Lake Vista in Whitefield starts from â‚¹1.2Cr.',
      propertyId: 'prop-lake',
      focusedProjectId: 'proj-lake',
      properties: [{ id: 'prop-lake', name: 'Lake Vista' }],
      locationAvailablePropertyIds: [],
    });
    expect(withoutLocation?.map((b) => b.id)).toEqual([
      'book-visit-prop-lake',
      'more-info-prop-lake',
      'project-properties-proj-lake',
    ]);

    const withLocation = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Lake Vista in Whitefield starts from â‚¹1.2Cr.',
      propertyId: 'prop-lake',
      focusedProjectId: 'proj-lake',
      properties: [{ id: 'prop-lake', name: 'Lake Vista' }],
      locationAvailablePropertyIds: ['prop-lake'],
    });
    expect(withLocation?.map((b) => b.id)).toEqual([
      'book-visit-prop-lake',
      'more-info-prop-lake',
      'location-prop-lake',
    ]);
  });

  test('location availability for another property does not add stale Location button', () => {
    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Lake Vista in Whitefield starts from â‚¹1.2Cr.',
      propertyId: 'prop-lake',
      focusedProjectId: 'proj-lake',
      properties: [{ id: 'prop-lake', name: 'Lake Vista' }],
      locationAvailablePropertyIds: ['prop-other'],
    });
    expect(buttons?.map((b) => b.id)).not.toContain('location-prop-lake');
    expect(buttons?.map((b) => b.id)).toContain('project-properties-proj-lake');
  });

  test('price reply with property id uses property detail buttons', () => {
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
      language: 'en',
    })?.map((b) => b.id)).toEqual([
      'book-visit-p1',
      'more-info-p1',
      'browse-projects',
    ]);
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

  test('visit confirmed buttons exclude property details and include view listings', () => {
    const buttons = resolveButtonsForBuyerSituation('visit_confirmed', {
      stage: 'confirmation',
      outboundText: 'Your visit is confirmed.',
      hasActiveVisit: true,
      visitStatus: 'confirmed',
      visitPropertyProjectId: 'proj-sunset',
      language: 'en',
    });
    expect(buttons?.map((b) => b.id)).toEqual([
      'visit-reschedule',
      'project-properties-proj-sunset',
      'call-me',
    ]);
    expect(buttons?.map((b) => b.id)).not.toContain('more-info-p1');
  });

  test('single property focus with active visit uses visit action buttons', () => {
    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Sunset Heights 1102 starts from ₹95L.',
      propertyId: 'prop-1102',
      hasActiveVisit: true,
      visitStatus: 'confirmed',
      visitPropertyProjectId: 'proj-sunset',
      language: 'hi',
    });
    expect(buttons?.map((b) => b.id)).toEqual([
      'visit-reschedule',
      'project-properties-proj-sunset',
      'call-me',
    ]);
  });

  test('post_visit prefers view listings over more-info when project known', () => {
    const buttons = resolveButtonsForBuyerSituation('post_visit', {
      stage: 'confirmation',
      outboundText: 'How was your visit?',
      hasCompletedVisit: true,
      visitPropertyProjectId: 'proj-sunset',
      language: 'en',
    });
    expect(buttons?.map((b) => b.id)).toEqual([
      'share-visit-feedback',
      'call-me',
      'project-properties-proj-sunset',
    ]);
  });

  test('property detail outbound with active visit on another unit keeps property CTAs', () => {
    const situation = detectBuyerButtonSituation({
      stage: 'shortlist',
      outboundText: '🏠 *Sunset Heights 1201*\n\n✨ Amenities: Pool\n\n📋 *Details:*\nBHK: 2',
      propertyId: 'prop-1201',
      visitPropertyId: 'prop-other',
      hasActiveVisit: true,
      visitStatus: 'confirmed',
      visitPropertyProjectId: 'proj-sunset',
      focusedProjectId: 'proj-sunset',
      language: 'en',
    });
    expect(situation).toBe('single_property_focus');
    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: '🏠 *Sunset Heights 1201*\n\n✨ Amenities: Pool',
      propertyId: 'prop-1201',
      visitPropertyId: 'prop-other',
      hasActiveVisit: true,
      visitStatus: 'confirmed',
      visitPropertyProjectId: 'proj-sunset',
      focusedProjectId: 'proj-sunset',
      language: 'en',
    });
    expect(buttons?.map((b) => b.id)).toEqual([
      'book-visit-prop-1201',
      'more-info-prop-1201',
      'project-properties-proj-sunset',
    ]);
  });

  test('price_discussed with active visit uses property detail buttons', () => {
    const buttons = resolveButtonsForBuyerSituation('price_discussed', {
      stage: 'shortlist',
      outboundText: 'Pricing for Sunset Heights is ₹95L.',
      propertyId: 'p1',
      hasActiveVisit: true,
      visitPropertyProjectId: 'proj-sunset',
      focusedProjectId: 'proj-sunset',
      language: 'en',
    });
    expect(buttons?.map((b) => b.id)).toEqual([
      'book-visit-p1',
      'more-info-p1',
      'project-properties-proj-sunset',
    ]);
  });

  test('flag ON multi-property list does not attach Book Visit for multiple allowed properties', () => {
    config.features.buttonScopeValidate = true;
    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Here are 2 options for you: Sunset Heights and Lake Vista.',
      recommendedPropertyIds: ['p-sunset', 'p-lake'],
      allowedPropertyIds: ['p-sunset', 'p-lake'],
      properties: [
        { id: 'p-sunset', name: 'Sunset Heights' },
        { id: 'p-lake', name: 'Lake Vista' },
      ],
    });

    expect(buttons?.map((b) => b.id).some((id) => id.startsWith('book-visit'))).toBe(false);
    expect(buttons?.map((b) => b.id)).toContain('browse-projects');
  });

  test('flag ON single allowed property rewrites property buttons to the allowed id', () => {
    config.features.buttonScopeValidate = true;
    const buttons = resolveButtonsForBuyerSituation('single_property_focus', {
      stage: 'shortlist',
      outboundText: 'Sunset Heights looks like a fit.',
      propertyId: 'out-of-scope',
      allowedPropertyIds: ['p-sunset'],
    });

    expect(buttons?.map((b) => b.id)).toContain('book-visit-p-sunset');
    expect(buttons?.map((b) => b.id)).toContain('more-info-p-sunset');
    expect(buttons?.map((b) => b.id)).not.toContain('book-visit-out-of-scope');
  });
});
