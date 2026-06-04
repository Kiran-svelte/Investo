import prisma from '../../config/prisma';
import logger from '../../config/logger';
import type { ToolContext } from './agent-state';
import { applyVisitMutationFromChat } from '../visitMutationFromChat.service';
import { isVisitCancelOrRescheduleMessage } from '../visitIntentFromMessage.service';
import type { LeadPipelineStatus } from '../../constants/agent-intent.constants';
import { LEAD_PIPELINE_STATUSES } from '../../constants/agent-intent.constants';
import { updateLeadStatusById } from './lead-status-actions';
import { resolveLeadForIntent, type LeadResolveParams } from './agent-lead-resolution.service';
import {
  getRecentAgentSessionMessages,
  type AgentSessionMessage,
} from './agent-session-messages.service';
import {
  buildAgentScopeFilter,
  buildVisitScopeFilter,
  formatDateIST,
  getISTDayBounds,
  getStatusEmoji,
  getTodayIST,
  getTomorrowIST,
  maskPhone,
} from './tools/format-helpers';

const visitInclude = {
  lead: { select: { customerName: true, phone: true } },
  property: { select: { name: true } },
  agent: { select: { name: true } },
};

function formatVisitLine(visit: {
  id: string;
  status: string;
  scheduledAt: Date;
  lead: { customerName: string | null; phone: string | null } | null;
  property: { name: string | null } | null;
  agent: { name: string | null } | null;
}): string {
  return [
    `${getStatusEmoji(visit.status)} *${visit.lead?.customerName ?? 'Unknown'}* (${maskPhone(visit.lead?.phone)})`,
    `Property: ${visit.property?.name ?? 'TBD'}`,
    `Time: ${formatDateIST(visit.scheduledAt)} | Status: ${visit.status}`,
    `Agent: ${visit.agent?.name ?? 'Unassigned'}`,
    `ID: ${visit.id}`,
  ].join('\n');
}

async function fetchVisitsForDate(
  context: ToolContext,
  date: string,
  label: string,
): Promise<string> {
  const [start, end] = getISTDayBounds(date);
  const visits = await prisma.visit.findMany({
    where: {
      ...buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
      scheduledAt: { gte: start, lte: end },
    },
    include: visitInclude,
    orderBy: { scheduledAt: 'asc' },
    take: 25,
  });
  // #region agent log
  fetch('http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a72821'},body:JSON.stringify({sessionId:'a72821',location:'agent-crm-query.service.ts:fetchVisitsForDate',message:'visit query result',data:{label,date,count:visits.length,userId:context.userId},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
  // #endregion
  if (!visits.length) {
    return `No visits scheduled for ${label.toLowerCase()} (${date}).`;
  }
  return [`*${label}'s visits (${date})*`, ...visits.map(formatVisitLine)].join('\n\n');
}

async function fetchLeadsAddedToday(context: ToolContext): Promise<string> {
  const [start, end] = getISTDayBounds(getTodayIST());
  const leads = await prisma.lead.findMany({
    where: {
      ...buildAgentScopeFilter(context.companyId, context.userRole, context.userId),
      createdAt: { gte: start, lte: end },
    },
    include: { assignedAgent: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  // #region agent log
  fetch('http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a72821'},body:JSON.stringify({sessionId:'a72821',location:'agent-crm-query.service.ts:fetchLeadsAddedToday',message:'leads today query result',data:{date:getTodayIST(),count:leads.length,userId:context.userId,role:context.userRole},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  if (!leads.length) {
    return `No new leads were added today (${getTodayIST()}) in your scope.`;
  }
  return [
    `*New leads today (${getTodayIST()})*`,
    ...leads.map(
      (lead, i) =>
        `${i + 1}. ${getStatusEmoji(lead.status)} *${lead.customerName ?? 'Unknown'}* ${maskPhone(lead.phone)}\n   Status: ${lead.status} | Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}\n   ID: ${lead.id}`,
    ),
  ].join('\n\n');
}

function wantsVisitTomorrow(text: string): boolean {
  if (/^\s*for\s+tomorrow\s*$/i.test(text)) return true;
  if (/^\s*(and\s+)?tomorrow\s*$/i.test(text)) return true;
  return (
    /\btomorrow\b/i.test(text)
    && /\b(visit|visits|schedule|scheduled|appointment|site|calendar|booked)\b/i.test(text)
  );
}

function wantsVisitToday(text: string): boolean {
  return (
    /\btoday\b/i.test(text)
    && /\b(visit|visits|schedule|scheduled|appointment|site|booked)\b/i.test(text)
  );
}

function wantsNewLeadsToday(text: string): boolean {
  if (/\b(update|set|mark|change|move)\b.*\b(lead|status)\b/i.test(text)) return false;
  if (/\bstatus\b.*\b(to|as)\b/i.test(text)) return false;
  if (/\bvisited\b/i.test(text) && /\b(lead|status)\b/i.test(text)) return false;
  return (
    /\b(new\s+leads?|leads?\s+(we\s+)?got|leads?\s+added|added\s+today|any\s+leads?)\b/i.test(text)
    || (/\bleads?\b/i.test(text) && /\btoday\b/i.test(text) && !/\b(update|status|visited)\b/i.test(text))
  );
}

function wantsConfirmVisit(text: string): boolean {
  if (/\b(update|set|mark|change|move)\b.*\b(status|lead)\b/i.test(text)) return false;
  if (/\bstatus\b.*\b(to|as)\b/i.test(text)) return false;
  const mentionsVisit =
    /\b(?:site\s+)?visits?\b/i.test(text)
    || /\bappointments?\b/i.test(text)
    || /\bthe\s+visit\b/i.test(text);
  return /\b(confirm|confirmed)\b/i.test(text) && mentionsVisit;
}

function wantsUpdateLeadStatus(text: string): boolean {
  return (
    /\b(update|set|mark|change|move)\b/i.test(text)
    && /\b(lead|status|customer|client)\b/i.test(text)
  ) || (
    /\bstatus\b/i.test(text)
    && /\b(to|as)\b/i.test(text)
    && /\b(lead|visited|contacted|negotiation|closed)\b/i.test(text)
  );
}

function parseLeadStatusFromMessage(text: string): LeadPipelineStatus | undefined {
  for (const status of LEAD_PIPELINE_STATUSES) {
    if (new RegExp(`\\b${status.replace('_', '[\\s_]?')}\\b`, 'i').test(text)) {
      return status;
    }
  }
  if (/\bvisited\b/i.test(text)) return 'visited';
  if (/\bcontacted\b/i.test(text)) return 'contacted';
  if (/\bnegotiat/i.test(text)) return 'negotiation';
  if (/\bclosed\s*won\b/i.test(text)) return 'closed_won';
  if (/\bclosed\s*lost\b/i.test(text)) return 'closed_lost';
  return undefined;
}

function parseLeadNameHintFromUpdateMessage(text: string): string | undefined {
  const patterns = [
    /\blead\s+(.+?)\s+status\b/i,
    /\bupdate\s+lead\s+(.+?)\s+status\b/i,
    /\b(?:for|of)\s+(.+?)\s+(?:status|to)\b/i,
    /\bstatus\s+(?:of|for)\s+(.+?)\s+to\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const hint = match?.[1]?.trim();
    if (hint && hint.length >= 2) return hint.replace(/\bto\s+visited\b/i, '').trim();
  }
  const toMatch = text.match(/\bto\s+(\w[\w\s]{1,40}?)\s*$/i);
  if (toMatch) return undefined;
  const nameMatch = text.match(
    /\b(?:lead|customer|client)\s+([a-z][a-z0-9\s]{2,40}?)(?:\s+status|\s+to\b)/i,
  );
  return nameMatch?.[1]?.trim();
}

async function tryDeterministicUpdateLeadStatus(
  context: ToolContext,
  text: string,
  recentMessages: AgentSessionMessage[] = [],
  sessionLeadId?: string | null,
): Promise<string | null> {
  if (!wantsUpdateLeadStatus(text)) return null;
  const status = parseLeadStatusFromMessage(text);
  if (!status) return null;

  const params: Partial<LeadResolveParams> = {
    leadName: parseLeadNameHintFromUpdateMessage(text),
  };
  const lead = await resolveLeadForIntent(context, params, sessionLeadId, recentMessages);
  if (!lead) {
    return 'Which lead should I update? Share the customer name or lead ID from your list.';
  }
  const result = await updateLeadStatusById(context, lead.leadId, status);
  return result.reply;
}

async function confirmNextUpcomingVisit(context: ToolContext): Promise<string> {
  const { getAgentSessionContext } = await import('../clientMemory.service');
  const sessionCtx = await getAgentSessionContext(context.sessionId);

  if (sessionCtx.lastVisitId) {
    const focused = await prisma.visit.findFirst({
      where: {
        id: sessionCtx.lastVisitId,
        ...buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
        status: { in: ['scheduled', 'confirmed'] },
      },
      include: visitInclude,
    });
    if (focused && focused.status === 'scheduled') {
      const updated = await prisma.visit.update({
        where: { id: focused.id },
        data: { status: 'confirmed' },
        include: visitInclude,
      });
      return `✅ Visit confirmed.\n\n${formatVisitLine(updated)}`;
    }
    if (focused?.status === 'confirmed') {
      return `That visit is already confirmed.\n\n${formatVisitLine(focused)}`;
    }
  }

  const visit = await prisma.visit.findFirst({
    where: {
      ...buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
      status: 'scheduled',
      scheduledAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { scheduledAt: 'asc' },
    include: visitInclude,
  });
  if (!visit) {
    return 'No upcoming scheduled visit found in your scope to confirm.';
  }
  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: { status: 'confirmed' },
    include: visitInclude,
  });
  return `✅ Visit confirmed.\n\n${formatVisitLine(updated)}`;
}

/**
 * Deterministic Zero-UI replies for common CRM lookups (no LLM hallucination).
 */
export async function tryDeterministicAgentVisitMutation(
  context: ToolContext,
  messageText: string,
): Promise<string | null> {
  if (!isVisitCancelOrRescheduleMessage(messageText)) return null;
  const mutation = await applyVisitMutationFromChat({
    companyId: context.companyId,
    message: messageText,
    visitScope: buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
  });
  if (!mutation.handled || !mutation.reply) return null;
  // #region agent log
  fetch('http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a72821'},body:JSON.stringify({sessionId:'a72821',location:'agent-crm-query.service.ts',message:'deterministic visit mutation',data:{userId:context.userId,mode:mutation.mode,visitId:mutation.visitId},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  return mutation.reply;
}

export async function tryDeterministicAgentCrmReply(
  context: ToolContext,
  messageText: string,
  options?: { sessionLeadId?: string | null },
): Promise<string | null> {
  const text = messageText.trim();
  if (!text) return null;

  try {
    const visitMutation = await tryDeterministicAgentVisitMutation(context, text);
    if (visitMutation) return visitMutation;

    const recentMessages = context.sessionId
      ? await getRecentAgentSessionMessages(context.sessionId, 5)
      : [];
    const statusUpdate = await tryDeterministicUpdateLeadStatus(
      context,
      text,
      recentMessages,
      options?.sessionLeadId,
    );
    if (statusUpdate) return statusUpdate;

    if (wantsConfirmVisit(text)) {
      return confirmNextUpcomingVisit(context);
    }

    if (wantsNewLeadsToday(text)) {
      // #region agent log
      fetch('http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a72821'},body:JSON.stringify({sessionId:'a72821',location:'agent-crm-query.service.ts',message:'deterministic new leads today',data:{userId:context.userId,role:context.userRole},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      return fetchLeadsAddedToday(context);
    }
    if (wantsVisitTomorrow(text)) {
      // #region agent log
      fetch('http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a72821'},body:JSON.stringify({sessionId:'a72821',location:'agent-crm-query.service.ts',message:'deterministic visits tomorrow',data:{userId:context.userId},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
      return fetchVisitsForDate(context, getTomorrowIST(), 'Tomorrow');
    }
    if (wantsVisitToday(text)) {
      return fetchVisitsForDate(context, getTodayIST(), 'Today');
    }
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Deterministic CRM query failed', { error: message, userId: context.userId });
    return `I could not load that from Investo right now (${message}). Please try again in a minute.`;
  }
}
