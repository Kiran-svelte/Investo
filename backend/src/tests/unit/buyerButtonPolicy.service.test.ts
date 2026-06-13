import { resolveBuyerComponents } from '../../services/buyer/buyerButtonPolicy.service';

describe('buyerButtonPolicy.service', () => {
  test('returning buyer bare greeting gets same browse buttons as new lead', () => {
    const components = resolveBuyerComponents({
      stage: 'rapport',
      outboundText: 'Hello! Welcome to *Palm Realty*.\n\nI\'m your assistant for *Palm Realty*',
      browseFilters: [
        { id: 'filter-apartment', title: 'Apartments' },
        { id: 'call-me', title: 'Call Me' },
      ],
    });
    expect(components).toHaveLength(1);
    expect(components[0].kind).toBe('buttons');
  });

  test('returns stage buttons for stranger rapport', () => {
    const components = resolveBuyerComponents({
      stage: 'rapport',
      outboundText: 'Hello! Welcome to Palm Realty.',
      browseFilters: [
        { id: 'filter-apartment', title: 'Apartments' },
        { id: 'call-me', title: 'Call Me' },
      ],
    });
    expect(components).toHaveLength(1);
    expect(components[0].kind).toBe('buttons');
  });

  test('blocks buttons on confirm prompts', () => {
    expect(
      resolveBuyerComponents({
        stage: 'visit_booking',
        outboundText: 'Just to confirm, would you like to book for Saturday 4pm?',
      }),
    ).toEqual([]);
  });

  test('never attaches visit_booking stage buttons on LLM turns', () => {
    expect(
      resolveBuyerComponents({
        stage: 'visit_booking',
        outboundText: 'Pick a time that works for you 🗓️',
      }),
    ).toEqual([]);
  });

  test('blocks buttons when outbound is a bare greeting', () => {
    expect(
      resolveBuyerComponents({
        stage: 'rapport',
        outboundText: 'Hi',
      }),
    ).toEqual([]);
  });

  test('shows post-visit buttons instead of Book Free Visit', () => {
    const components = resolveBuyerComponents({
      stage: 'rapport',
      outboundText: 'How did you find the property after your visit?',
      hasCompletedVisit: true,
    });
    expect(components).toHaveLength(1);
    expect(components[0].kind).toBe('buttons');
    if (components[0].kind !== 'buttons') return;
    const ids = components[0].buttons.map((b) => b.id);
    expect(ids).toContain('share-visit-feedback');
    expect(ids).toContain('call-me');
    expect(ids).not.toContain('book-visit');
  });

  test('post-visit buttons appear even on welcome-back greeting text', () => {
    const components = resolveBuyerComponents({
      stage: 'shortlist',
      outboundText: 'Welcome back! How did your visit go?',
      hasCompletedVisit: true,
      isReturningGreeting: true,
    });
    expect(components).toHaveLength(1);
    if (components[0].kind === 'buttons') {
      expect(components[0].buttons.map((b) => b.id)).toContain('share-visit-feedback');
    }
  });
});
