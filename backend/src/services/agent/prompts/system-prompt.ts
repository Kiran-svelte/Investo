import { UserRole } from '@prisma/client';
import type { AgentPromptContext } from '../agent-prompt-context.service';

interface BuildSystemPromptParams {
  userName: string;
  companyName: string;
  userRole: UserRole;
  currentDateIST: string;
  currentTimeIST: string;
  clientMemoryBlock?: string;
  conversationHistory?: AgentPromptContext['conversationHistory'];
  upcomingVisits?: AgentPromptContext['upcomingVisits'];
  leadStatus?: AgentPromptContext['leadStatus'];
  recentErrors?: AgentPromptContext['recentErrors'];
  availableTools?: string[];
  workflowExecutionGuide?: string;
}

function formatConversationHistory(
  history: AgentPromptContext['conversationHistory'] | undefined,
): string {
  if (!history?.length) return '';
  const lines = history.slice(-5).map((m) => `${m.role}: ${m.content.slice(0, 120)}`);
  return `## Recent copilot turns\n${lines.join('\n')}`;
}

function formatUpcomingVisits(visits: AgentPromptContext['upcomingVisits'] | undefined): string {
  if (!visits?.length) return '';
  const lines = visits.slice(0, 3).map(
    (v) => `- ${v.projectName} on ${v.date} ${v.time} (${v.status})`,
  );
  return `## Upcoming visits\n${lines.join('\n')}`;
}

export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  const roleLine = params.userRole === 'sales_agent'
    ? 'You help this sales agent manage their own leads, visits, and client conversations.'
    : 'You help this admin manage company operations, team performance, leads, visits, and settings.';

  const contextBlocks = [
    formatConversationHistory(params.conversationHistory),
    formatUpcomingVisits(params.upcomingVisits),
    params.leadStatus?.id && params.leadStatus.id !== 'none'
      ? `## Active lead\nStatus: ${params.leadStatus.status}${params.leadStatus.interestedProject ? ` | Project: ${params.leadStatus.interestedProject}` : ''}${params.leadStatus.budgetRange ? ` | Budget: ${params.leadStatus.budgetRange}` : ''}`
      : '',
    params.workflowExecutionGuide ? `## Workflows\n${params.workflowExecutionGuide}` : '',
    params.availableTools?.length
      ? `## Tools available\n${params.availableTools.slice(0, 20).join(', ')}`
      : '',
    params.clientMemoryBlock ?? '',
  ].filter(Boolean);

  return [
    'You are Investo AI Assistant, a WhatsApp-based CRM copilot for real estate teams.',
    `User: ${params.userName}`,
    `Company: ${params.companyName}`,
    `Role: ${params.userRole}`,
    `Current IST date/time: ${params.currentDateIST}, ${params.currentTimeIST}`,
    roleLine,
    '',
    'Rules:',
    '- Respond in the user language when clear; otherwise use concise English.',
    '- Format for WhatsApp using short lines, *bold* labels, and numbered lists when useful.',
    '- Never expose internal implementation details. IDs may be shown only when needed to disambiguate records.',
    '- MANDATORY: For visits, leads, calendar, or "new leads today" you MUST call the matching tool before answering. Never say "unable to retrieve" or "no leads" without a tool result.',
    '- Visits today → listVisitsToday. Visits tomorrow / "for tomorrow" → listVisitsTomorrow or listVisitsByDateRange with tomorrow\'s date.',
    '- New leads today → listLeadsAddedToday (not listLeads without a date).',
    '- Use tools for all CRM facts and mutations. Do not invent records.',
    '- Respect tool access and company boundaries.',
    '- For destructive actions, use tools that create a pending confirmation and tell the user to reply yes or no.',
    '- Keep simple replies under 5 lines.',
    ...contextBlocks,
  ]
    .filter(Boolean)
    .join('\n');
}
