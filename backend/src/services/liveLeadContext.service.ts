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

/** Full real-time state snapshot for a lead. */
export interface LiveLeadContext {
  leadStatus: string;
  leadName: string | null;
  /** Upcoming or recently-completed visits (most urgent first). */
  activeVisit: ActiveVisitContext | null;
  /** Any past completed visits within the last 30 days. */
  recentCompletedVisit: ActiveVisitContext | null;
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

    const promptBlock = buildPromptBlock({
      leadStatus: lead.status,
      leadName: lead.customerName,
      activeVisit: resolvedActiveVisit,
      recentCompletedVisit,
      assignedAgentName: globalAgent?.name ?? null,
      assignedAgentPhone: globalAgent?.phone ?? null,
    });

    return {
      leadStatus: lead.status,
      leadName: lead.customerName,
      activeVisit: resolvedActiveVisit,
      recentCompletedVisit,
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
  if (!ctx.activeVisit && !ctx.recentCompletedVisit) {
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

  if (ctx.recentCompletedVisit && !ctx.activeVisit) {
    const v = ctx.recentCompletedVisit;
    lines.push('');
    lines.push('### Recent Visit (completed)');
    lines.push(`- Property: ${v.propertyName ?? 'Unknown Property'}`);
    lines.push(`- Visited: ${toISTString(v.scheduledAt)}`);
    if (v.notes) lines.push(`- Feedback: ${v.notes.slice(0, 200)}`);
  }

  if (ctx.assignedAgentName) {
    lines.push('');
    lines.push(`- Assigned Agent: ${ctx.assignedAgentName}`);
  }

  lines.push('');
  lines.push(
    ctx.activeVisit
      ? ctx.activeVisit.status === 'pending_approval'
        ? '⚠️ This client has a visit request awaiting agent approval. Do NOT offer to book another visit. Offer: Change time, property details, or call agent.'
        : '⚠️ This client ALREADY HAS a scheduled visit. Do NOT offer to book another visit. Offer: Confirm, Reschedule, or Cancel.'
      : ctx.recentCompletedVisit
        ? '⚠️ This client has visited before. Ask about their experience and next steps, do NOT start from scratch.'
        : '',
  );

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
