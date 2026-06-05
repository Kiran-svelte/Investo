import { z } from 'zod';
import { WORKFLOW_IDS, type WorkflowId } from '../../../constants/workflow.constants';
import { runWorkflow } from '../../workflow/workflow-engine.service';
import { allWorkflowIds } from '../../workflow/workflow-registry';
import { formatWorkflowCatalogForTool } from '../../workflow/workflow-catalog.util';
import { ToolContext } from '../agent-state';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

const workflowIdSchema = z.enum(WORKFLOW_IDS);

const workflowParamsSchema = z.object({
  workflowId: workflowIdSchema,
  message: z.string().optional(),
  leadId: z.string().uuid().optional(),
  leadName: z.string().optional(),
  visitId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  propertyName: z.string().optional(),
  agentId: z.string().uuid().optional(),
  agentName: z.string().optional(),
  scheduledAt: z.string().optional(),
  newScheduledAt: z.string().optional(),
  status: z.string().optional(),
  note: z.string().optional(),
  outcome: z.string().optional(),
});

/**
 * Workflow bridge tools — let the LangGraph agent run multi-step CRM workflows.
 * Atomic reads (listVisitsToday, listLeads) stay as direct tool calls.
 */
export function createWorkflowTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'listWorkflows',
      description:
        'List all CRM workflows the agent can run. Use before runWorkflow when unsure which workflow fits.',
      schema: z.object({}),
      func: async () => formatWorkflowCatalogForTool(),
    }),
    new DynamicStructuredTool({
      name: 'runWorkflow',
      description:
        'Execute a multi-step CRM workflow (booking, reschedule, assign, brochure, etc.). ' +
        `IDs: ${allWorkflowIds().join(', ')}. ` +
        'Use direct list/get tools for simple lookups; use this only when a workflow is required.',
      schema: workflowParamsSchema,
      func: async (input) => {
        const workflowId = input.workflowId as WorkflowId;
        const result = await runWorkflow(
          workflowId,
          {
            toolContext: context,
            messageText: input.message ?? input.note ?? '',
            recentMessages: [],
            companyName: context.companyName ?? '',
            sessionLeadId: context.sessionLeadId,
            sessionVisitId: context.sessionVisitId,
            staffPhone: context.staffPhone,
            channel: 'staff',
          },
          {
            message: input.message,
            messageText: input.message,
            leadId: input.leadId,
            leadName: input.leadName,
            visitId: input.visitId,
            propertyId: input.propertyId,
            propertyName: input.propertyName,
            agentId: input.agentId,
            agentName: input.agentName,
            scheduledAt: input.scheduledAt,
            newScheduledAt: input.newScheduledAt ?? input.scheduledAt,
            status: input.status,
            note: input.note,
            outcome: input.outcome,
          },
        );

        if (!result.ok) {
          const completed = result.completedSteps?.length
            ? ` Completed before failure: ${result.completedSteps.join(' → ')}.`
            : '';
          return (result.reply ?? `Workflow "${workflowId}" could not be completed.`) + completed;
        }
        const completed = result.completedSteps?.length
          ? `\n\nSteps completed: ${result.completedSteps.join(' → ')}`
          : '';
        return (result.reply ?? `Workflow "${workflowId}" completed successfully.`) + completed;
      },
    }),
  ];
}
