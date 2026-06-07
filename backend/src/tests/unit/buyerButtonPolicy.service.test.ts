import { resolveBuyerComponents } from '../../services/buyer/buyerButtonPolicy.service';

describe('buyerButtonPolicy.service', () => {
  test('returns no buttons for returning greeting ack', () => {
    expect(
      resolveBuyerComponents({
        stage: 'rapport',
        outboundText: 'Welcome back! Still exploring options?',
        isReturningGreeting: true,
      }),
    ).toEqual([]);
  });

  test('returns stage buttons for stranger rapport', () => {
    const components = resolveBuyerComponents({
      stage: 'rapport',
      outboundText: 'Hello! Welcome to Palm Realty.',
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
});
