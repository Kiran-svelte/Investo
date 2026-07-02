import {
  buildBuyerRapportTurnResult,
  buildBuyerPropertyLocationReply,
  enforceTurnComponentBudget,
  isBuyerLocationRequest,
  isHumanTakeoverActive,
  resolveHeroMediaComponent,
  shouldAttachPropertyDetailMediaForBuyerTurn,
} from '../../services/whatsapp/whatsappTurnOrchestrator.service';

describe('whatsappTurnOrchestrator.service', () => {
  test('isHumanTakeoverActive when agent_active or ai disabled', () => {
    expect(isHumanTakeoverActive({ status: 'agent_active', aiEnabled: true })).toBe(true);
    expect(isHumanTakeoverActive({ status: 'ai_active', aiEnabled: false })).toBe(true);
    expect(isHumanTakeoverActive({ status: 'ai_active', aiEnabled: true })).toBe(false);
  });

  test('returning buyer Hi gets enriched welcome with buttons', async () => {
    const result = await buildBuyerRapportTurnResult({
      companyName: 'Palm Realty',
      messageText: 'Hi',
      hasPriorOutbound: true,
      stage: 'rapport',
      browseFilters: [
        { id: 'filter-apartment', title: 'Apartments' },
        { id: 'call-me', title: 'Call Me' },
      ],
    });
    expect(result?.handled).toBe(true);
    expect(result?.text).toContain('Welcome to *Palm Realty*');
    expect(result?.components?.length).toBeGreaterThan(0);
  });

  test('buildBuyerRapportTurnResult for stranger includes buttons', async () => {
    const result = await buildBuyerRapportTurnResult({
      companyName: 'Palm Realty',
      messageText: 'Hi',
      hasPriorOutbound: false,
      stage: 'rapport',
    });
    expect(result?.components?.length).toBeGreaterThan(0);
  });

  test('resolveHeroMediaComponent caps to one image for shortlist', () => {
    const hero = resolveHeroMediaComponent(
      [{ id: 'p1', name: 'Lake Vista', images: ['https://cdn.example.com/1.jpg'] }],
      { mediaComponent: null },
      'shortlist',
    );
    expect(hero?.kind).toBe('media');
    if (hero?.kind === 'media') expect(hero.mime).toBe('image/jpeg');
  });

  test('enforceTurnComponentBudget keeps interactive with property media attachments', () => {
    const budget = enforceTurnComponentBudget([
      { kind: 'buttons', buttons: [{ id: 'book', title: 'Book' }] },
      { kind: 'media', url: 'https://x.jpg', mime: 'image/jpeg' },
      { kind: 'media', url: 'https://y.pdf', mime: 'application/pdf' },
    ]);
    expect(budget).toHaveLength(3);
    expect(budget.filter((c) => c.kind === 'media')).toHaveLength(2);
    expect(budget[budget.length - 1]?.kind).toBe('buttons');
  });

  test('shouldAttachPropertyDetailMediaForBuyerTurn blocks stale selected-property media on unrelated replies', () => {
    for (const messageText of ['It was good', 'There no option to tap', 'Yes']) {
      expect(shouldAttachPropertyDetailMediaForBuyerTurn({
        messageText,
        selectedPropertyId: 'prop-sunset',
        componentPropertyId: 'prop-sunset',
        hasSelectedPropertyPatch: true,
      })).toBe(false);
    }
  });

  test('shouldAttachPropertyDetailMediaForBuyerTurn allows explicit media or newly selected property context', () => {
    expect(shouldAttachPropertyDetailMediaForBuyerTurn({
      messageText: 'send photos for this property',
      selectedPropertyId: 'prop-sunset',
      componentPropertyId: 'prop-sunset',
    })).toBe(true);

    expect(shouldAttachPropertyDetailMediaForBuyerTurn({
      messageText: 'I like Lake Vista',
      selectedPropertyId: 'prop-sunset',
      resolvedPropertyId: 'prop-lake',
      componentPropertyId: 'prop-lake',
    })).toBe(true);
  });

  test('isBuyerLocationRequest detects direct location asks without catching browse preferences', () => {
    expect(isBuyerLocationRequest('Locations')).toBe(true);
    expect(isBuyerLocationRequest('send map for Sunset Heights 1102')).toBe(true);
    expect(isBuyerLocationRequest('I need 3 BHK in Whitefield')).toBe(false);
  });

  test('buildBuyerPropertyLocationReply uses verified address and map pin only when present', () => {
    const reply = buildBuyerPropertyLocationReply({
      id: 'prop-1',
      name: 'Sunset Heights 1102',
      locationArea: 'Whitefield',
      locationCity: 'Bangalore',
      locationPincode: '560066',
      latitude: { toString: () => '12.96980000' },
      longitude: { toString: () => '77.74990000' },
    });

    expect(reply).toContain('*Sunset Heights 1102*');
    expect(reply).toContain('Address: Whitefield, Bangalore, 560066, India');
    expect(reply).toContain('https://www.google.com/maps?q=12.96980000%2C77.74990000');
  });
});
