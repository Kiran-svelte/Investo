import { UserRole } from '@prisma/client';

export interface BuildSystemPromptParams {
  userName: string;
  companyName: string;
  userRole: UserRole;
  currentDateIST: string;
  currentTimeIST: string;
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
  }>;
  upcomingVisits: Array<{
    id: string;
    projectName: string;
    date: string;
    time: string;
    status: string;
  }>;
  leadStatus: {
    id: string;
    status: string;
    lastInteraction: string;
    interestedProject?: string;
    budgetRange?: string;
  };
  recentErrors: Array<{
    userMessage: string;
    aiResponse: string;
    timestamp: string;
  }>;
  clientMemoryBlock?: string;
  /** Tool names bound to the model for this role — keeps the agent aware of callable actions. */
  availableTools?: string[];
}

export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  const {
    userName,
    companyName,
    userRole,
    currentDateIST,
    currentTimeIST,
    conversationHistory,
    upcomingVisits,
    leadStatus,
    recentErrors,
    clientMemoryBlock,
    availableTools = [],
  } = params;

  const roleLine = userRole === 'sales_agent'
    ? 'You help this sales agent manage their own leads, visits, and client conversations.'
    : 'You help this admin manage company operations, team performance, leads, visits, and settings.';

  const contextSections: string[] = [];

  if (upcomingVisits.length > 0) {
    contextSections.push(
      '📅 CURRENT UPCOMING VISITS (for this lead/agent):',
      ...upcomingVisits.map((v) => `- ${v.projectName}: ${v.date} at ${v.time} (${v.status})`),
      '',
    );
  } else {
    contextSections.push('📅 Upcoming visits: None scheduled', '');
  }

  contextSections.push(
    '👤 CURRENT LEAD STATUS:',
    `- Status: ${leadStatus.status}`,
    `- Last interaction: ${leadStatus.lastInteraction}`,
    leadStatus.interestedProject ? `- Interested in: ${leadStatus.interestedProject}` : '',
    leadStatus.budgetRange ? `- Budget: ${leadStatus.budgetRange}` : '',
    '',
  );

  if (conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-10);
    contextSections.push(
      '💬 RECENT CONVERSATION HISTORY (last few messages):',
      ...recentHistory.map((msg) => `${msg.role === 'user' ? 'User' : 'You'}: ${msg.content}`),
      '',
    );
  }

  if (recentErrors.length > 0) {
    const lastError = recentErrors[recentErrors.length - 1];
    contextSections.push(
      '⚠️ RECENT ISSUE:',
      `User asked: "${lastError.userMessage}"`,
      `You responded: "${lastError.aiResponse}"`,
      'Try a different approach or ask clarifying questions this time.',
      '',
    );
  }

  const toolLine = availableTools.length
    ? `Available tools for your role: ${availableTools.join(', ')}`
    : '';

  return [
    'You are Investo AI Assistant, a WhatsApp-based CRM copilot for real estate teams.',
    `User: ${userName}`,
    `Company: ${companyName}`,
    `Role: ${userRole}`,
    `Current IST date/time: ${currentDateIST}, ${currentTimeIST}`,
    roleLine,
    '',
    '=== CURRENT CONTEXT (USE THIS) ===',
    ...contextSections,
    '=== END CONTEXT ===',
    '',
    'RULES:',
    '1. RESPOND IN USER\'S LANGUAGE: Use same language as user (Hindi/English/Kannada mix is fine).',
    '2. FORMAT FOR WHATSAPP: Use short lines, *bold* labels, emojis for visual hierarchy.',
    '3. NEVER EXPOSE INTERNAL DETAILS: Don\'t mention tool names, APIs, or system internals.',
    '4. USE TOOLS FOR FACTS: For leads, visits, properties, or updates, call the appropriate tool. Do not invent data.',
    '',
    '5. CONTEXT AWARENESS (CRITICAL):',
    '   - If user asks "when is my visit?" → Check upcoming visits list above → Respond with details',
    '   - If user asks to book a visit → First check if they already have a visit at that time',
    '   - If user says "reschedule" → Reference existing visit from upcoming visits list',
    '   - If you failed before (see "RECENT ISSUE" section) → Try a different approach or ask clarifying question',
    '',
    '6. TOOL USAGE GUIDELINES:',
    '   - Simple lookups → call the direct tool (listVisitsToday, listLeadsAddedToday, getPropertyDetails, etc.)',
    '   - Multi-step mutations → call runWorkflow with the matching workflow id (schedule_visit, reschedule_visit, assign_agent, etc.)',
    '   - Single-step updates → updateLeadStatus, scheduleVisit, rescheduleVisit when a full workflow is not needed',
    '   - Call listWorkflows if unsure which workflow applies; never call tools speculatively',
    toolLine,
    '',
    '7. WHEN YOU DON\'T KNOW:',
    '   - Don\'t say "I hit an issue" or "I couldn\'t complete that"',
    '   - Instead: "I don\'t have that information. Could you provide more details?"',
    upcomingVisits.length > 0
      ? `   - Or: "I see you have ${upcomingVisits.length} upcoming visit(s). Which one would you like to discuss?"`
      : '   - Or: "Could you share the lead name or visit date so I can look it up?"',
    '',
    '8. DESTRUCTIVE ACTIONS: Require confirmation. Say "Please reply YES to confirm cancellation."',
    '',
    '9. KEEP RESPONSES CONCISE: Max 5-7 lines for simple replies, use buttons for complex choices.',
    '',
    clientMemoryBlock ? clientMemoryBlock : '',
  ]
    .filter(Boolean)
    .join('\n');
}
