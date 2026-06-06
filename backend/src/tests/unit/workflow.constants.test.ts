import {
  CLARIFICATION_BAND,
  MUTATION_CONFIDENCE_THRESHOLD,
  MUTATION_WORKFLOW_IDS,
  WORKFLOW_CONFIDENCE_THRESHOLD,
  WORKFLOW_LLM_TEMPERATURE,
} from '../../constants/workflow.constants';

/** investo.md §2.3 / §4 algorithm constants */
describe('workflow.constants (A+ thresholds)', () => {
  it('mutation execute threshold is 0.80', () => {
    expect(MUTATION_CONFIDENCE_THRESHOLD).toBe(0.8);
  });

  it('clarification band is 0.70–0.80', () => {
    expect(CLARIFICATION_BAND.low).toBe(0.7);
    expect(CLARIFICATION_BAND.high).toBe(0.8);
    expect(CLARIFICATION_BAND.low).toBeLessThan(CLARIFICATION_BAND.high);
  });

  it('query floor stays below mutation threshold', () => {
    expect(WORKFLOW_CONFIDENCE_THRESHOLD).toBeLessThan(MUTATION_CONFIDENCE_THRESHOLD);
  });

  it('LLM temperature is near-zero for classification', () => {
    expect(WORKFLOW_LLM_TEMPERATURE).toBeLessThanOrEqual(0.05);
  });

  it('mutation workflows include visit lifecycle ids', () => {
    expect(MUTATION_WORKFLOW_IDS).toEqual(
      expect.arrayContaining(['schedule_visit', 'reschedule_visit', 'cancel_visit']),
    );
  });
});
