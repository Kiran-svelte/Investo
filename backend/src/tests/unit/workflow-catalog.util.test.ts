import {
  WORKFLOW_GUIDE,
  buildWorkflowExecutionGuideForPrompt,
  formatWorkflowCatalogForTool,
} from '../../services/workflow/workflow-catalog.util';
import { WORKFLOW_IDS } from '../../constants/workflow.constants';

describe('workflow-catalog.util', () => {
  it('documents all 15 production workflows', () => {
    expect(WORKFLOW_GUIDE).toHaveLength(WORKFLOW_IDS.length);
    for (const id of WORKFLOW_IDS) {
      expect(WORKFLOW_GUIDE.some((entry) => entry.id === id)).toBe(true);
    }
  });

  it('includes the 4-step execution contract in the prompt guide', () => {
    const guide = buildWorkflowExecutionGuideForPrompt();
    expect(guide).toContain('RIGHT TOOL');
    expect(guide).toContain('CORRECT WORKFLOW');
    expect(guide).toContain('ORDER');
    expect(guide).toContain('SUCCESS');
    expect(guide).toContain('schedule_visit');
    expect(guide).toContain('escalate_to_human');
  });

  it('lists workflows with triggers for listWorkflows tool', () => {
    const catalog = formatWorkflowCatalogForTool();
    expect(catalog).toContain('new_lead');
    expect(catalog).toContain('reschedule_visit');
    expect(catalog).toContain('Required steps');
  });
});
