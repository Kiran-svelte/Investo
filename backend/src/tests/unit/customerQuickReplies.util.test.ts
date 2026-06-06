import { resolveCustomerQuickActions } from '../../utils/customerQuickReplies.util';

describe('customerQuickReplies.util', () => {
  const properties = [
    { id: 'p-green', name: 'Green Acres' },
    { id: 'p-sunset', name: 'Sunset Heights' },
    { id: 'p-lake', name: 'Lake Vista' },
  ];

  it('returns Book Visit and Property Details when alternatives are mentioned', () => {
    const actions = resolveCustomerQuickActions({
      stage: 'shortlist',
      outboundText:
        'Green Acres offers plots only. Sunset Heights and Lake Vista have 2BHK apartments. Would you like more details?',
      properties,
      recommendedPropertyIds: ['p-sunset', 'p-lake'],
    });
    expect(actions?.buttons.map((b) => b.id)).toEqual([
      'book-visit-p-green',
      'more-info-p-green',
      'more-info-p-sunset',
    ]);
  });

  it('returns null when client already has an active visit', () => {
    expect(
      resolveCustomerQuickActions({
        stage: 'shortlist',
        outboundText: 'Your visit is tomorrow.',
        properties,
        hasActiveVisit: true,
      }),
    ).toBeNull();
  });
});
