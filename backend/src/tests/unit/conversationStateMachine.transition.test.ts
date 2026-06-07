import { isAllowedStageTransition } from '../../services/conversationStateMachine';

describe('conversationStateMachine stage transitions', () => {
  test('blocks visit_booking → rapport without start-over', () => {
    expect(isAllowedStageTransition('visit_booking', 'rapport', 'Hi')).toBe(false);
    expect(isAllowedStageTransition('visit_booking', 'qualify', 'hello')).toBe(false);
  });

  test('allows visit_booking → rapport when user pivots', () => {
    expect(isAllowedStageTransition('visit_booking', 'rapport', 'something new')).toBe(true);
    expect(isAllowedStageTransition('confirmation', 'qualify', 'start over')).toBe(true);
  });

  test('allows forward transitions', () => {
    expect(isAllowedStageTransition('commitment', 'visit_booking', 'tomorrow 10am')).toBe(true);
  });
});
