import {
  buildBuyerRapportTurnResult,
  enforceTurnComponentBudget,
  isHumanTakeoverActive,
  resolveHeroMediaComponent,
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
});
