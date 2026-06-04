import prisma from '../../config/prisma';
import logger from '../../config/logger';
import type { ToolContext } from './agent-state';
import { applyVisitMutationFromChat } from '../visitMutationFromChat.service';
import { isVisitCancelOrRescheduleMessage } from '../visitIntentFromMessage.service';
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
  return (
    /\b(new\s+leads?|leads?\s+(we\s+)?got|leads?\s+added|added\s+today)\b/i.test(text)
    || (/\bleads?\b/i.test(text) && /\btoday\b/i.test(text))
  );
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
): Promise<string | null> {
  const text = messageText.trim();
  if (!text) return null;

  try {
    const visitMutation = await tryDeterministicAgentVisitMutation(context, text);
    if (visitMutation) return visitMutation;

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
