import prisma from '../../config/prisma';
import { transitionLeadStatus } from '../leadTransition.service';
import type { ToolContext } from './agent-state';
import { buildAgentScopeFilter } from './tools/format-helpers';
import { createPendingConfirmation } from './confirmation.service';
import type { LeadPipelineStatus } from '../../constants/agent-intent.constants';

export interface UpdateLeadStatusResult {
  handled: boolean;
  reply: string;
  leadId?: string;
  requiresConfirmation?: boolean;
}

/**
 * Deterministic lead status update (shared by LangChain tools and intent orchestrator).
 */
export async function updateLeadStatusById(
  context: ToolContext,
  leadId: string,
  status: LeadPipelineStatus,
): Promise<UpdateLeadStatusResult> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ...buildAgentScopeFilter(context.companyId, context.userRole, context.userId) },
    select: { id: true, customerName: true, status: true },
  });
  if (!lead) {
    return { handled: true, reply: 'Lead not found or access denied.' };
  }

  if (status === 'closed_lost') {
    if (!context.sessionId) {
      return { handled: true, reply: 'Confirmation session unavailable.' };
    }
    const message = `Confirm marking ${lead.customerName ?? 'this lead'} as closed lost?\nReply "yes" to confirm or "no" to cancel.`;
    await createPendingConfirmation(context.sessionId, 'closeLeadLost', { leadId }, message);
    return { handled: true, reply: message, leadId, requiresConfirmation: true };
  }

  const force = context.userRole === 'company_admin' || context.userRole === 'super_admin';
  const ok = await transitionLeadStatus(leadId, status, { force });
  if (!ok) {
    return {
      handled: true,
      reply: `Cannot move lead from ${lead.status} to ${status}. Use a valid pipeline step or ask an admin.`,
      leadId,
    };
  }

  const name = lead.customerName ?? 'lead';
  return {
    handled: true,
    reply: `✅ Lead *${name}* status updated to *${status}*.`,
    leadId,
  };
}
