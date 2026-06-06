import {
  detectActiveVisitMutationBias,
  evaluateMutationGate,
} from '../../services/workflow/workflow-engine.service';

describe('workflow confidence gate', () => {
  it('bias reschedule without time clarifies instead of executing', () => {
    const bias = detectActiveVisitMutationBias('push my appointment please', {
      visitId: 'visit-1',
    });
    expect(bias?.workflowId).toBe('reschedule_visit');
    const gate = evaluateMutationGate(bias!.workflowId, 0.75, 'bias_detector');
    expect(gate).toBe('clarify');
  });

  it('bias cancel with active visit executes at exact confidence', () => {
    const bias = detectActiveVisitMutationBias('cancel my visit', { visitId: 'visit-1' });
    expect(bias?.workflowId).toBe('cancel_visit');
    const gate = evaluateMutationGate(bias!.workflowId, 1, 'exact_regex');
    expect(gate).toBe('execute');
  });

  it('classifier mutation in clarify band returns clarify', () => {
    const gate = evaluateMutationGate('schedule_visit', 0.75, 'classifier');
    expect(gate).toBe('clarify');
  });

  it('classifier mutation well below threshold falls through', () => {
    const gate = evaluateMutationGate('schedule_visit', 0.65, 'classifier');
    expect(gate).toBe('fallthrough');
  });
});
