/**
 * Admin Log Tools
 *
 * WhatsApp agent tools for querying the AgentActionLog table.
 * Restricted to company_admin and super_admin roles.
 *
 * @module agent/tools/admin-log-tools
 */

import { z } from 'zod';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { isAdminRole, formatDateIST } from './format-helpers';
import { getRecentActionLogs, type ActionStatus } from '../../agent-action-log.service';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

const STATUS_EMOJI: Record<string, string> = {
  success: '✅',
  failed: '❌',
  skipped: '⏭️',
};

/**
 * Returns a formatted string for a single action log entry.
 *
 * @param log - Prisma AgentActionLog record.
 * @returns Human-readable WhatsApp-formatted string.
 */
function formatLogEntry(log: {
  createdAt: Date;
  action: string;
  triggeredBy: string;
  status: string;
  result: string | null;
  errorMessage: string | null;
  resourceType: string | null;
  resourceId: string | null;
  durationMs: number | null;
}): string {
  const emoji = STATUS_EMOJI[log.status] ?? '❓';
  const lines = [
    `${emoji} *${log.action}* — ${formatDateIST(log.createdAt)}`,
    `Triggered by: ${log.triggeredBy}`,
  ];
  if (log.resourceType && log.resourceId) {
    lines.push(`Resource: ${log.resourceType} ${log.resourceId.slice(0, 8)}`);
  }
  if (log.result) lines.push(`Result: ${log.result}`);
  if (log.errorMessage) lines.push(`Error: ${log.errorMessage}`);
  if (log.durationMs != null) lines.push(`Duration: ${log.durationMs}ms`);
  return lines.join('\n');
}

/**
 * Creates the admin-only log query tool for the WhatsApp agent.
 *
 * @param context - Caller's role and company scope.
 * @returns Array containing the getAiActionLog tool.
 */
export function createAdminLogTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'getAiActionLog',
      description:
        'Show recent AI automated actions (cron jobs, tool calls, automated status changes). ' +
        'Filter by action name or status (success|failed|skipped). Admin only.',
      schema: z.object({
        action: z.string().optional().describe('Filter by action name (partial match)'),
        status: z.enum(['success', 'failed', 'skipped']).optional(),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
      }),
      func: async ({ action, status, limit }) => {
        if (!isAdminRole(context.userRole)) {
          return 'Only admins can view the AI action log.';
        }
        const logs = await getRecentActionLogs(
          context.companyId,
          limit ?? DEFAULT_LIST_LIMIT,
          action,
          status as ActionStatus | undefined,
        );
        if (!logs.length) return 'No AI actions logged yet.';
        return [
          `*AI Action Log (last ${logs.length})*`,
          ...logs.map(formatLogEntry),
        ].join('\n\n');
      },
    }),
  ];
}
