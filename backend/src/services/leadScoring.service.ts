import prisma from '../config/prisma';
import {
  leadScoreFromConversation,
  mergeLeadMetadata,
  parseLeadMetadata,
  type LeadScore,
} from './leadMetadata.service';
import { notificationEngine } from './notification.engine';
import logger from '../config/logger';
import { socketService, SOCKET_EVENTS } from './socket.service';

export async function syncLeadScoreFromConversation(
  leadId: string,
  urgencyScore: number,
  valueScore: number,
): Promise<LeadScore> {
  const score = leadScoreFromConversation(urgencyScore, valueScore);
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { metadata: true, companyId: true, assignedAgentId: true, customerName: true, phone: true } });
  if (!lead) return score;

  const prev = parseLeadMetadata(lead.metadata).lead_score;
  const metadata = mergeLeadMetadata(lead.metadata, { lead_score: score });
  await prisma.lead.update({
    where: { id: leadId },
    data: { metadata: metadata as object },
  });

  // Emit real-time update whenever the score changes
  if (score !== prev) {
    socketService.emitToCompany(lead.companyId, SOCKET_EVENTS.LEAD_UPDATED, {
      lead: { id: leadId, lead_score: score },
    });
  }

  if (score === 'hot' && prev !== 'hot') {
    try {
      await notificationEngine.notify({
        companyId: lead.companyId,
        userId: lead.assignedAgentId ?? null,
        type: 'system_alert',
        title: 'Hot Lead Alert',
        message: `Lead ${lead.customerName || lead.phone} scored HOT (urgency ${urgencyScore}, value ${valueScore})`,
        data: { leadId, lead_score: score },
      });
      if (lead.assignedAgentId) {
        const fullLead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (fullLead) await notificationEngine.onLeadAssigned(fullLead, lead.assignedAgentId);
      }
    } catch (err: any) {
      logger.warn('Hot lead notification failed', { leadId, error: err.message });
    }
  }

  return score;
}
