/**
 * Live Lead Context Service
 *
 * Fetches the lead's current real-time state from the database and formats it
 * for injection into the AI system prompt and fast-path greeting responses.
 *
 * This is the global fix for "Context Amnesia":
 * - The RAG vector store (client_memory_chunks) is eventually consistent.
 *   A visit booked 30 seconds ago may not yet be embedded.
 * - This service does a direct Prisma read — always current, never stale.
 * - The resulting block is injected AT THE TOP of the system prompt so the LLM
 *   always knows the client's real state before generating any response.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';
import { findPendingVisitApprovalForLead } from './visitPendingApproval.service';
import { findActiveCallRequest } from './callRequest.service';
import { isPostVisitLeadStatus } from '../utils/buyerLeadProgress.util';

/** Represents an upcoming or recent visit for CTA and prompt injection. */
export interface ActiveVisitContext {
  visitId: string;
  propertyId: string | null;
  propertyName: string | null;
  status: string;
  scheduledAt: Date;
  agentName: string | null;
  agentPhone: string | null;
  notes: string | null;
}

/** Scheduled callback awaiting or confirmed with the sales team. */
export interface ActiveCallContext {
  callId: string;
  scheduledAt: Date;
  status: string;
  agentName: string | null;
  agentPhone: string | null;
}

/** Full real-time state snapshot for a lead. */
export interface LiveLeadContext {
  leadStatus: string;
  leadName: string | null;
  /** Upcoming or recently-completed visits (most urgent first). */
  activeVisit: ActiveVisitContext | null;
  /** Any past completed visits within the last 30 days. */
  recentCompletedVisit: ActiveVisitContext | null;
  /** Most recent cancelled visit within 30 days when no active visit exists. */
  recentCancelledVisit: ActiveVisitContext | null;
  /** Upcoming agent callback when no visit takes precedence. */
  activeCall: ActiveCallContext | null;
  assignedAgentName: string | null;
  assignedAgentPhone: string | null;
  /** Formatted multi-line block ready to embed in system prompts. */
  promptBlock: string;
}

/** IST locale string for a Date — consistent with the rest of the codebase. */
function toISTString(date: Date): string {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Build a human-readable visit status label for the AI prompt.
 * @param status - Raw visit status from DB
 */
function visitStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending_approval: '⏳ PENDING APPROVAL',
    scheduled: '📅 SCHEDULED',
    confirmed: '✅ CONFIRMED',
    completed: '✔️ COMPLETED',
    cancelled: '❌ CANCELLED',
    no_show: '⚠️ NO-SHOW',
    rescheduled: '🔄 RESCHEDULED',
  };
  return map[status] ?? status.toUpperCase();
}

/**
 * Fetches the real-time lead context from the database.
 *
 * @param leadId - The UUID of the lead.
 * @param companyId - Used for scoping the query.
 * @returns A {@link LiveLeadContext} object with a ready-to-embed `promptBlock`.
 */
export async function getLiveLeadContext(
  leadId: string,
  companyId: string,
): Promise<LiveLeadContext> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: {
        status: true,
        customerName: true,
        assignedAgentId: true,
        visits: {
          orderBy: { scheduledAt: 'asc' },
          take: 5,
          include: {
            property: { select: { id: true, name: true } },
            agent: { select: { name: true, phone: true } },
          },
        },
      },
    });

    if (!lead) {
      return buildEmptyContext();
    }

    // Agent info may also come from lead.assignedAgentId if visits have no agent
    let globalAgent: { name: string | null; phone: string | null } | null = null;
    if (lead.assignedAgentId) {
      globalAgent = await prisma.user.findUnique({
        where: { id: lead.assignedAgentId },
        select: { name: true, phone: true },
      });
    }

    // Find the most relevant upcoming or recent visit
    const upcoming = (lead.visits ?? []).find(
      (v) =>
        ['scheduled', 'confirmed', 'rescheduled'].includes(v.status) &&
        new Date(v.scheduledAt) >= new Date(now.getTime() - 2 * 60 * 60 * 1000), // within 2h ago
    );
    const recentCompleted = (lead.visits ?? []).find(
      (v) => v.status === 'completed' && new Date(v.scheduledAt) >= thirtyDaysAgo,
    );
    const recentCancelled = (lead.visits ?? []).find(
      (v) => v.status === 'cancelled' && new Date(v.scheduledAt) >= thirtyDaysAgo,
    );

    const toVisitContext = (v: (typeof lead.visits)[number]): ActiveVisitContext => ({
      visitId: v.id,
      propertyId: v.property?.id ?? null,
      propertyName: v.property?.name ?? null,
      status: v.status,
      scheduledAt: v.scheduledAt,
      agentName: v.agent?.name ?? globalAgent?.name ?? null,
      agentPhone: v.agent?.phone ?? globalAgent?.phone ?? null,
      notes: v.notes ?? null,
    });

    const activeVisit = upcoming ? toVisitContext(upcoming) : null;
    const recentCompletedVisit = recentCompleted ? toVisitContext(recentCompleted) : null;
    const recentCancelledVisit =
      !activeVisit && recentCancelled ? toVisitContext(recentCancelled) : null;

    let resolvedActiveVisit = activeVisit;
    if (!resolvedActiveVisit) {
      const pendingApproval = await findPendingVisitApprovalForLead({ companyId, leadId });
      if (pendingApproval) {
        resolvedActiveVisit = {
          visitId: pendingApproval.approvalId,
          propertyId: pendingApproval.propertyId,
          propertyName: pendingApproval.propertyName ?? null,
          status: 'pending_approval',
          scheduledAt: new Date(pendingApproval.scheduledAt),
          agentName: globalAgent?.name ?? null,
          agentPhone: globalAgent?.phone ?? null,
          notes: null,
        };
      }
    }

    let activeCall: ActiveCallContext | null = null;
    if (!resolvedActiveVisit) {
      const callRow = await findActiveCallRequest({ companyId, leadId });
      if (callRow) {
        const callAgent = await prisma.user.findUnique({
          where: { id: callRow.agent_id },
          select: { name: true, phone: true },
        });
        activeCall = {
          callId: callRow.id,
          scheduledAt: callRow.scheduled_at,
          status: callRow.status,
          agentName: callAgent?.name ?? globalAgent?.name ?? null,
          agentPhone: callAgent?.phone ?? globalAgent?.phone ?? null,
        };
      }
    }

    const promptBlock = buildPromptBlock({
      leadStatus: lead.status,
      leadName: lead.customerName,
      activeVisit: resolvedActiveVisit,
      recentCompletedVisit,
      recentCancelledVisit,
      activeCall,
      assignedAgentName: globalAgent?.name ?? null,
      assignedAgentPhone: globalAgent?.phone ?? null,
    });

    return {
      leadStatus: lead.status,
      leadName: lead.customerName,
      activeVisit: resolvedActiveVisit,
      recentCompletedVisit,
      recentCancelledVisit,
      activeCall,
      assignedAgentName: globalAgent?.name ?? null,
      assignedAgentPhone: globalAgent?.phone ?? null,
      promptBlock,
    };
  } catch (err: unknown) {
    logger.warn('getLiveLeadContext failed — returning empty context', {
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    return buildEmptyContext();
  }
}

/** Returns a safe empty context when the lead cannot be fetched. */
function buildEmptyContext(): LiveLeadContext {
  return {
    leadStatus: 'unknown',
    leadName: null,
    activeVisit: null,
    recentCompletedVisit: null,
    recentCancelledVisit: null,
    activeCall: null,
    assignedAgentName: null,
    assignedAgentPhone: null,
    promptBlock: '',
  };
}

/**
 * Formats the live context into a structured block for the AI system prompt.
 * Placed at the TOP of the prompt so it takes precedence over all RAG context.
 */
function buildPromptBlock(ctx: Omit<LiveLeadContext, 'promptBlock'>): string {
  const postVisitByCrmStatus =
    !ctx.activeVisit && isPostVisitLeadStatus(ctx.leadStatus);

  if (
    !ctx.activeVisit
    && !ctx.recentCompletedVisit
    && !ctx.recentCancelledVisit
    && !ctx.activeCall
    && !postVisitByCrmStatus
  ) {
    // Still inject lead status so the AI doesn't treat a hot lead as new
    const lines = [
      '## 🔴 LIVE CLIENT STATE (real-time from CRM — highest priority)',
      `- CRM Status: ${ctx.leadStatus}`,
      ctx.assignedAgentName ? `- Assigned Agent: ${ctx.assignedAgentName}` : null,
      '- No upcoming visits scheduled.',
      '',
      '⚠️ Do NOT claim the client has visited before unless confirmed below.',
    ];
    return lines.filter((l): l is string => l !== null).join('\n');
  }

  const lines: string[] = [
    '## 🔴 LIVE CLIENT STATE (real-time from CRM — highest priority)',
    `- CRM Status: ${ctx.leadStatus}`,
  ];

  if (ctx.activeVisit) {
    const v = ctx.activeVisit;
    lines.push('');
    lines.push('### Upcoming Site Visit');
    lines.push(`- Status: ${visitStatusLabel(v.status)}`);
    lines.push(`- Property: ${v.propertyName ?? 'Unknown Property'}`);
    lines.push(`- When: ${toISTString(v.scheduledAt)}`);
    if (v.agentName) lines.push(`- Agent: ${v.agentName}${v.agentPhone ? ` (${v.agentPhone})` : ''}`);
    if (v.notes) lines.push(`- Notes: ${v.notes.slice(0, 200)}`);
  }

  if (ctx.recentCancelledVisit && !ctx.activeVisit) {
    const v = ctx.recentCancelledVisit;
    lines.push('');
    lines.push('### ❌ RECENTLY CANCELLED VISIT');
    lines.push(`- Property: ${v.propertyName ?? 'Unknown Property'}`);
    lines.push(`- Was scheduled: ${toISTString(v.scheduledAt)}`);
  }

  if (ctx.activeCall && !ctx.activeVisit) {
    const c = ctx.activeCall;
    lines.push('');
    lines.push('### 📞 SCHEDULED CALLBACK');
    lines.push(`- Status: ${c.status}`);
    lines.push(`- When: ${toISTString(c.scheduledAt)}`);
    if (c.agentName) lines.push(`- Agent: ${c.agentName}${c.agentPhone ? ` (${c.agentPhone})` : ''}`);
  }

  if (ctx.recentCompletedVisit && !ctx.activeVisit) {
    const v = ctx.recentCompletedVisit;
    const daysSince = Math.floor(
      (Date.now() - new Date(v.scheduledAt).getTime()) / (1000 * 60 * 60 * 24),
    );
    lines.push('');
    lines.push('### ✔️ COMPLETED SITE VISIT (recent)');
    lines.push(`- Property: ${v.propertyName ?? 'Unknown Property'}`);
    lines.push(`- Visited: ${toISTString(v.scheduledAt)} (${daysSince} day${daysSince === 1 ? '' : 's'} ago)`);
    if (v.notes) lines.push(`- Feedback: ${v.notes.slice(0, 200)}`);
    lines.push('');
    lines.push('🚫 STAGE OVERRIDE — DO NOT invite this customer to book a site visit.');
    lines.push('   They have already visited. Instead: ask about their impression, decision timeline,');
    lines.push('   budget finalisation, or next steps (negotiation / loan / booking amount).');
  } else if (postVisitByCrmStatus) {
    lines.push('');
    lines.push('### ✔️ POST-VISIT CLIENT (CRM status)');
    lines.push(`- CRM marks this lead as *${ctx.leadStatus}* — treat as post-visit.`);
    lines.push('');
    lines.push('🚫 STAGE OVERRIDE — DO NOT ask for area, budget, or BHK from scratch.');
    lines.push('   DO NOT offer to book a first site visit. Focus on feedback, negotiation, or next steps.');
  }

  if (ctx.assignedAgentName) {
    lines.push('');
    lines.push(`- Assigned Agent: ${ctx.assignedAgentName}`);
  }

  lines.push('');
  if (ctx.activeVisit) {
    if (ctx.activeVisit.status === 'pending_approval') {
      lines.push(
        '⚠️ RULE: Visit request is awaiting approval. Do NOT offer to book another visit.'
        + ' Offer: Change time, share property details, or connect with agent.',
      );
    } else {
      lines.push(
        '⚠️ RULE: Customer ALREADY HAS a scheduled visit. Do NOT offer to book another.'
        + ' Offer ONLY: Confirm, Reschedule, or Cancel.',
      );
    }
  } else if (ctx.recentCompletedVisit || postVisitByCrmStatus) {
    lines.push(
      '🚫 ABSOLUTE RULE: This customer has ALREADY VISITED the property.'
      + ' NEVER suggest booking a site visit. NEVER ask if they want to schedule a visit.'
      + ' NEVER re-interrogate for area/budget/BHK unless they explicitly start a new search.'
      + ' Focus ONLY on: their impression, decision, paperwork, booking amount, or loan.',
    );
  }

  return lines.filter((l) => l !== '').join('\n');
}

/**
 * Builds the WhatsApp-formatted greeting for a returning client with an active visit.
 * Used by the fast-path to override the generic "What area are you looking in?" greeting.
 *
 * @param customerName - The client's name, or null if unknown.
 * @param visit - The active visit context.
 * @returns A multi-line WhatsApp message body string.
 */
export function buildVisitAwareGreeting(
  customerName: string | null,
  visit: ActiveVisitContext,
  companyName: string,
): string {
  const name = customerName ? ` ${customerName}` : '';
  const visitDate = toISTString(visit.scheduledAt);
  const property = visit.propertyName ?? 'the property';
  const agentLine = visit.agentName ? `\n👤 Agent: *${visit.agentName}*` : '';

  const statusPreamble =
    visit.status === 'confirmed'
      ? 'Your site visit is *confirmed* ✅'
      : visit.status === 'pending_approval'
        ? 'Your site visit request is *awaiting team approval* ⏳'
      : visit.status === 'scheduled'
        ? 'You have an upcoming site visit 🗓️'
        : `Your visit status: *${visit.status}*`;

  return [
    `Hello${name}! Welcome back to *${companyName}* 👋`,
    '',
    `${statusPreamble}:`,
    `🏠 *${property}*`,
    `📅 ${visitDate}${agentLine}`,
    '',
    `Would you like to:`,
    `✅ Confirm the visit`,
    `📅 Reschedule`,
    `❌ Cancel`,
    `📞 Call agent`,
  ].join('\n');
}

/**
 * WhatsApp greeting when a returning buyer has a scheduled callback (no active visit).
 */
export function buildCallAwareGreeting(
  customerName: string | null,
  call: ActiveCallContext,
  companyName: string,
): string {
  const name = customerName ? ` ${customerName}` : '';
  const when = toISTString(call.scheduledAt);
  const agentLine = call.agentName ? `\n👤 Agent: *${call.agentName}*` : '';
  const statusPreamble =
    call.status === 'confirmed'
      ? 'Your callback is *confirmed* ✅'
      : call.status === 'pending_approval'
        ? 'Your callback request is *awaiting approval* ⏳'
        : 'You have an upcoming callback 📞';

  return [
    `Hello${name}! Welcome back to *${companyName}* 👋`,
    '',
    `${statusPreamble}:`,
    `📅 ${when}${agentLine}`,
    '',
    'Would you like to change the time, cancel, or explore more projects while you wait?',
  ].join('\n');
}
