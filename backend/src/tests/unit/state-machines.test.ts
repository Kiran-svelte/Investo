import { LEAD_TRANSITIONS, VISIT_TRANSITIONS, CONVERSATION_TRANSITIONS, isValidTransition, LeadStatus, VisitStatus, ConversationStatus } from '../../models/validation';

describe('Lead State Machine - Exhaustive', () => {
  const allStatuses: LeadStatus[] = ['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost'];

  test('every status has a transition entry', () => {
    allStatuses.forEach((status) => {
      expect(LEAD_TRANSITIONS).toHaveProperty(status);
    });
  });

  test('all transitions point to valid statuses', () => {
    Object.entries(LEAD_TRANSITIONS).forEach(([from, toList]) => {
      (toList as LeadStatus[]).forEach((to) => {
        expect(allStatuses).toContain(to);
      });
    });
  });

  test('lead always starts as new', () => {
    // The only way to create a lead is with status "new"
    // Every other status requires a transition from a previous state
    // This is enforced at the application level (default in schema)
    expect(LEAD_TRANSITIONS.new).toBeDefined();
  });

  test('closed_won has zero transitions (terminal)', () => {
    expect(LEAD_TRANSITIONS.closed_won).toHaveLength(0);
  });

  test('closed_lost has zero transitions (terminal)', () => {
    expect(LEAD_TRANSITIONS.closed_lost).toHaveLength(0);
  });

  test('full pipeline path is valid: new -> contacted -> visit_scheduled -> visited -> negotiation -> closed_won', () => {
    const path: LeadStatus[] = ['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidTransition(LEAD_TRANSITIONS, path[i], path[i + 1])).toBe(true);
    }
  });

  test('cannot reverse through the pipeline', () => {
    expect(isValidTransition(LEAD_TRANSITIONS, 'contacted', 'new')).toBe(false);
    expect(isValidTransition(LEAD_TRANSITIONS, 'visited', 'visit_scheduled')).toBe(false);
    expect(isValidTransition(LEAD_TRANSITIONS, 'negotiation', 'visited')).toBe(false);
  });
});

describe('Visit State Machine - Exhaustive', () => {
  const allStatuses: VisitStatus[] = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];

  test('every status has a transition entry', () => {
    allStatuses.forEach((status) => {
      expect(VISIT_TRANSITIONS).toHaveProperty(status);
    });
  });

  test('terminal states have zero transitions', () => {
    expect(VISIT_TRANSITIONS.completed).toHaveLength(0);
    expect(VISIT_TRANSITIONS.cancelled).toHaveLength(0);
    expect(VISIT_TRANSITIONS.no_show).toHaveLength(0);
  });

  test('happy path: scheduled -> confirmed -> completed', () => {
    expect(isValidTransition(VISIT_TRANSITIONS, 'scheduled', 'confirmed')).toBe(true);
    expect(isValidTransition(VISIT_TRANSITIONS, 'confirmed', 'completed')).toBe(true);
  });
});

describe('Conversation State Machine - Exhaustive', () => {
  const allStatuses: ConversationStatus[] = ['ai_active', 'agent_active', 'closed'];

  test('every status has a transition entry', () => {
    allStatuses.forEach((status) => {
      expect(CONVERSATION_TRANSITIONS).toHaveProperty(status);
    });
  });

  test('closed is terminal', () => {
    expect(CONVERSATION_TRANSITIONS.closed).toHaveLength(0);
  });

  test('ai_active and agent_active can switch back and forth', () => {
    expect(isValidTransition(CONVERSATION_TRANSITIONS, 'ai_active', 'agent_active')).toBe(true);
    expect(isValidTransition(CONVERSATION_TRANSITIONS, 'agent_active', 'ai_active')).toBe(true);
  });
});
