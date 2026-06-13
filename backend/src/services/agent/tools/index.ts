import { ToolContext } from '../agent-state';
import { type AgentTool } from './langchain-runtime';
import { createAdminTools } from './admin-tools';
import { createAdminLogTools } from './admin-log-tools';
import { createAnalyticsTools } from './analytics-tools';
import { createBrochureTools } from './brochure-tools';
import { createBulkMessageTools } from './bulk-message-tools';
import { createCalendarTools } from './calendar-tools';
import { createConversationTools } from './conversation-tools';
import { createEmiTools } from './emi-tools';
import { createLeadReadTools, createLeadMutationTools } from './lead-tools';
import { createNotificationTools } from './notification-tools';
import { createPropertyTools } from './property-tools';
import { createUserTools } from './user-tools';
import { createVisitTools } from './visit-tools';
import { createWorkflowTools } from './workflow-tools';

function isAdminRole(role: string): boolean {
  return role === 'company_admin' || role === 'super_admin';
}

function isOperationsRole(role: string): boolean {
  return role === 'operations';
}

/**
 * Returns the full tool set available to the calling user based on their role.
 * All tools enforce their own internal permission checks as a second layer.
 *
 * @param context - Caller's identity and company scope.
 * @returns Flat array of agent tools scoped to the caller's role.
 */
export function getToolsForRole(context: ToolContext): AgentTool[] {
  if (context.userRole === 'viewer') {
    return [
      ...createPropertyTools(context),
      ...createAnalyticsTools(context),
      ...createCalendarTools(context),
      ...createEmiTools(context),
    ];
  }

  const tools: AgentTool[] = [
    ...createPropertyTools(context),
    ...createNotificationTools(context),
    ...createEmiTools(context),
    ...createBrochureTools(context),
  ];

  if (isOperationsRole(context.userRole)) {
    tools.push(
      ...createLeadReadTools(context),
      ...createVisitTools(context),
      ...createCalendarTools(context),
      ...createAnalyticsTools(context),
    );
    return tools;
  }

  const isAdmin = isAdminRole(context.userRole);

  if (context.userRole === 'sales_agent' || isAdmin) {
    tools.push(
      ...createWorkflowTools(context),
      ...createVisitTools(context),
      ...createLeadReadTools(context),
      ...createLeadMutationTools(context, {
        allowCreate: isAdmin,
        allowAssign: isAdmin,
        allowPortfolioTransfer: isAdmin,
      }),
      ...createConversationTools(context),
      ...createBulkMessageTools(context),
      ...createCalendarTools(context),
      ...createAnalyticsTools(context),
    );
  }

  if (isAdmin) {
    tools.push(
      ...createUserTools(context),
      ...createAdminTools(context),
      ...createAdminLogTools(context),
    );
  }

  return tools;
}

