import {
  classifyMessageIntent,
  getObjectionPlaybook,
  isAllowedStageTransition,
  policyBrain,
  type ConversationState,
} from '../../services/conversationStateMachine';

function baseState(stage: ConversationState['stage']): ConversationState {
  return {
    stage,
    previousStage: null,
    messageCount: 2,
    stageEnteredAt: new Date(),
    commitments: {
      budgetConfirmed: false,
      locationConfirmed: false,
      propertyTypeConfirmed: false,
      timelineConfirmed: false,
      propertyInterestShown: false,
      visitSlotDiscussed: false,
      visitSlotConfirmed: false,
      contactInfoShared: false,
    },
    objectionCount: 0,
    lastObjectionType: null,
    consecutiveObjections: 0,
    urgencyScore: 3,
    valueScore: 4,
    escalationReason: null,
    selectedPropertyId: null,
    recommendedProperties: [],
    proposedVisitTime: null,
  };
}

describe('conversationStateMachine (chunk 07)', () => {
  describe('isAllowedStageTransition', () => {
    it('blocks visit_booking regression to rapport without pivot phrase', () => {
      expect(isAllowedStageTransition('visit_booking', 'rapport', 'Hi')).toBe(false);
      expect(isAllowedStageTransition('confirmation', 'qualify', 'hello')).toBe(false);
      expect(isAllowedStageTransition('commitment', 'shortlist', 'thanks')).toBe(false);
    });

    it('allows explicit pivot phrases from protected booking stages', () => {
      expect(isAllowedStageTransition('visit_booking', 'rapport', 'something new')).toBe(true);
      expect(isAllowedStageTransition('confirmation', 'qualify', 'start over')).toBe(true);
    });
  });

  describe('OBJECTION_PLAYBOOKS', () => {
    it('exposes verbatim empathy/reframe/bridge copy for price_too_high', () => {
      const playbook = getObjectionPlaybook('price_too_high');
      expect(playbook.empathyFirst).toContain('budget is important');
      expect(playbook.reframe).toContain('per-sqft price');
      expect(playbook.bridgeToValue).toContain('EMI');
      expect(playbook.fallbackOffer).toContain('ongoing offers');
    });

    it('wires handle_objection prompt modifiers from playbook', () => {
      const message = 'This property is too expensive for our budget';
      const { intent, objectionType } = classifyMessageIntent(
        message,
        'shortlist',
        { consecutiveObjections: 0 },
      );
      expect(intent).toBe('objection');
      expect(objectionType).toBe('price_too_high');

      const action = policyBrain.decideNextAction(
        baseState('shortlist'),
        intent,
        objectionType,
        message,
      );
      expect(action.action).toBe('handle_objection');
      expect(action.promptModifiers?.join(' ')).toContain(playbookSnippet('price_too_high'));
      expect(action.promptModifiers?.join(' ')).toContain('FALLBACK:');
    });
  });

  describe('escalation policy', () => {
    it('escalates price negotiation without suggesting agent_active takeover', () => {
      const action = policyBrain.decideNextAction(
        baseState('shortlist'),
        'escalation_request',
        undefined,
        'I need a discount on the final price',
      );
      expect(action.action).toBe('escalate');
      expect(action.suggestedLeadStatus).toBe('negotiation');
    });
  });
});

function playbookSnippet(type: 'price_too_high'): string {
  const p = getObjectionPlaybook(type);
  return p.empathyFirst.slice(0, 24);
}
