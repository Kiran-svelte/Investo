import { shouldAttachContextualQuickReplies } from '../../utils/contextQuickReplies.util';

describe('shouldAttachContextualQuickReplies', () => {
  it('suppresses menus after a completed visit mutation', () => {
    expect(
      shouldAttachContextualQuickReplies({
        stage: 'confirmation',
        outboundText: 'Visit rescheduled to Monday 8pm',
        recentAction: 'rescheduled',
      }),
    ).toBe(false);
  });

  it('suppresses menus on yes/no or explicit visit time confirmation', () => {
    expect(
      shouldAttachContextualQuickReplies({
        stage: 'confirmation',
        outboundText: 'Just to confirm, would you like to schedule your site visit for Monday at 8:00 pm?',
      }),
    ).toBe(false);
  });

  it('allows menus on soft property follow-up questions', () => {
    expect(
      shouldAttachContextualQuickReplies({
        stage: 'shortlist',
        outboundText:
          'Sunset Heights has 2BHK from ₹83L. Would you like more details or to schedule a site visit?',
      }),
    ).toBe(true);
  });

  it('suppresses menus during visit_booking scheduling prompts', () => {
    expect(
      shouldAttachContextualQuickReplies({
        stage: 'visit_booking',
        outboundText: "Great choice! Let's schedule your visit to Sunset Heights. When would you prefer to visit?",
      }),
    ).toBe(false);
  });

  it('allows menus for normal shortlist follow-ups', () => {
    expect(
      shouldAttachContextualQuickReplies({
        stage: 'shortlist',
        outboundText: 'Here are three options in your budget.',
      }),
    ).toBe(true);
  });
});
