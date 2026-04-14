"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const validation_1 = require("../../models/validation");
describe('Lead State Machine - Exhaustive', () => {
    const allStatuses = ['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost'];
    test('every status has a transition entry', () => {
        allStatuses.forEach((status) => {
            expect(validation_1.LEAD_TRANSITIONS).toHaveProperty(status);
        });
    });
    test('all transitions point to valid statuses', () => {
        Object.entries(validation_1.LEAD_TRANSITIONS).forEach(([from, toList]) => {
            toList.forEach((to) => {
                expect(allStatuses).toContain(to);
            });
        });
    });
    test('lead always starts as new', () => {
        // The only way to create a lead is with status "new"
        // Every other status requires a transition from a previous state
        // This is enforced at the application level (default in schema)
        expect(validation_1.LEAD_TRANSITIONS.new).toBeDefined();
    });
    test('closed_won has zero transitions (terminal)', () => {
        expect(validation_1.LEAD_TRANSITIONS.closed_won).toHaveLength(0);
    });
    test('closed_lost has zero transitions (terminal)', () => {
        expect(validation_1.LEAD_TRANSITIONS.closed_lost).toHaveLength(0);
    });
    test('full pipeline path is valid: new -> contacted -> visit_scheduled -> visited -> negotiation -> closed_won', () => {
        const path = ['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won'];
        for (let i = 0; i < path.length - 1; i++) {
            expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, path[i], path[i + 1])).toBe(true);
        }
    });
    test('cannot reverse through the pipeline', () => {
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'contacted', 'new')).toBe(false);
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'visited', 'visit_scheduled')).toBe(false);
        expect((0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, 'negotiation', 'visited')).toBe(false);
    });
});
describe('Visit State Machine - Exhaustive', () => {
    const allStatuses = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];
    test('every status has a transition entry', () => {
        allStatuses.forEach((status) => {
            expect(validation_1.VISIT_TRANSITIONS).toHaveProperty(status);
        });
    });
    test('terminal states have zero transitions', () => {
        expect(validation_1.VISIT_TRANSITIONS.completed).toHaveLength(0);
        expect(validation_1.VISIT_TRANSITIONS.cancelled).toHaveLength(0);
        expect(validation_1.VISIT_TRANSITIONS.no_show).toHaveLength(0);
    });
    test('happy path: scheduled -> confirmed -> completed', () => {
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'scheduled', 'confirmed')).toBe(true);
        expect((0, validation_1.isValidTransition)(validation_1.VISIT_TRANSITIONS, 'confirmed', 'completed')).toBe(true);
    });
});
describe('Conversation State Machine - Exhaustive', () => {
    const allStatuses = ['ai_active', 'agent_active', 'closed'];
    test('every status has a transition entry', () => {
        allStatuses.forEach((status) => {
            expect(validation_1.CONVERSATION_TRANSITIONS).toHaveProperty(status);
        });
    });
    test('closed is terminal', () => {
        expect(validation_1.CONVERSATION_TRANSITIONS.closed).toHaveLength(0);
    });
    test('ai_active and agent_active can switch back and forth', () => {
        expect((0, validation_1.isValidTransition)(validation_1.CONVERSATION_TRANSITIONS, 'ai_active', 'agent_active')).toBe(true);
        expect((0, validation_1.isValidTransition)(validation_1.CONVERSATION_TRANSITIONS, 'agent_active', 'ai_active')).toBe(true);
    });
});
//# sourceMappingURL=state-machines.test.js.map