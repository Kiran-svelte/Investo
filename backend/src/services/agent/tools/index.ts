import { ToolContext } from '../agent-state';
import { type AgentTool } from './langchain-runtime';
import { createAdminTools } from './admin-tools';
import { createAnalyticsTools } from './analytics-tools';
import { createCalendarTools } from './calendar-tools';
import { createConversationTools } from './conversation-tools';
import { createEmiTools } from './emi-tools';
import { createLeadTools } from './lead-tools';
import { createNotificationTools } from './notification-tools';
import { createPropertyTools } from './property-tools';
import { createUserTools } from './user-tools';
import { createVisitTools } from './visit-tools';

function isAdminRole(role: string): boolean {
  return role === 'company_admin' || role === 'super_admin';
}

export function getToolsForRole(context: ToolContext): AgentTool[] {
  const tools: AgentTool[] = [
    ...createPropertyTools(context),
    ...createNotificationTools(context),
    ...createEmiTools(context),
  ];

  if (context.userRole === 'sales_agent' || isAdminRole(context.userRole)) {
    tools.push(
      ...createVisitTools(context),
      ...createLeadTools(context),
      ...createConversationTools(context),
      ...createCalendarTools(context),
      ...createAnalyticsTools(context),
    );
  }

  if (isAdminRole(context.userRole)) {
    tools.push(...createUserTools(context), ...createAdminTools(context));
  }

  return tools;
}
