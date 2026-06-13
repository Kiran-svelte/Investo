import prisma from '../config/prisma';
import logger from '../config/logger';

/**
 * Sends an immediate WhatsApp notification to the agent who received a new lead.
 * Non-throwing — a notification failure must never block lead creation.
 *
 * @param agentId - ID of the agent who was assigned.
 * @param leadId - ID of the newly assigned lead.
 * @param companyId - Company tenant scope.
 */
export async function notifyAgentOfNewLead(agentId: string, leadId: string, companyId: string): Promise<void> {
  try {
    const [agent, lead] = await Promise.all([
      prisma.user.findFirst({
        where: { id: agentId, companyId },
        select: { name: true, phone: true },
      }),
      prisma.lead.findFirst({
        where: { id: leadId, companyId },
        select: { customerName: true, phone: true, source: true, budgetMin: true, budgetMax: true, locationPreference: true, propertyType: true },
      }),
    ]);

    if (!agent?.phone || !lead) return;

    const formatBudget = (value: number) => {
      if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
      if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
      if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
      return `₹${value}`;
    };
    const budget =
      lead.budgetMin && lead.budgetMax
        ? `${formatBudget(Number(lead.budgetMin))}–${formatBudget(Number(lead.budgetMax))}`
        : lead.budgetMin
          ? formatBudget(Number(lead.budgetMin))
          : lead.budgetMax
            ? formatBudget(Number(lead.budgetMax))
            : '';

    const lines = [
      `🆕 *New Lead Assigned*`,
      `Hi ${agent.name}!`,
      ``,
      `Name: ${lead.customerName ?? 'Unknown'}`,
      `Phone: ${lead.phone.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2')}`,
      `Source: ${lead.source}`,
      ...(lead.propertyType ? [`Type: ${lead.propertyType}`] : []),
      ...(lead.locationPreference ? [`Location: ${lead.locationPreference}`] : []),
      ...(budget ? [`Budget: ${budget}`] : []),
      ``,
      `Reply with any question or ask me to log first contact.`,
    ];

    const { whatsappService } = await import('./whatsapp.service');
    await whatsappService.sendCompanyTextMessage(agent.phone, lines.join('\n'), companyId);
  } catch (err: unknown) {
    logger.error('Failed to notify agent of new lead assignment', {
      agentId,
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Assign lead to the active sales agent with the fewest non-terminal leads.
 * After assignment, sends an immediate WhatsApp notification to the assigned agent.
 *
 * @param companyId - Company tenant scope.
 * @param leadId - ID of the lead to notify about (optional; skips notification if omitted).
 * @returns ID of the assigned agent, or null if no active agents exist.
 */
export async function assignLeadRoundRobin(companyId: string, leadId?: string): Promise<string | null> {
  const agents = await prisma.user.findMany({
    where: { companyId, role: 'sales_agent', status: 'active' },
    select: { id: true },
  });

  if (agents.length === 0) return null;

  const leadCounts = await prisma.lead.groupBy({
    by: ['assignedAgentId'],
    where: {
      companyId,
      status: { notIn: ['closed_won', 'closed_lost'] },
      assignedAgentId: { in: agents.map((a) => a.id) },
    },
    _count: { id: true },
  });

  const countMap = new Map(leadCounts.map((l) => [l.assignedAgentId, l._count.id]));

  let minAgent = agents[0].id;
  let minCount = countMap.get(agents[0].id) ?? 0;
  for (const agent of agents) {
    const count = countMap.get(agent.id) ?? 0;
    if (count < minCount) {
      minCount = count;
      minAgent = agent.id;
    }
  }

  if (leadId) {
    void notifyAgentOfNewLead(minAgent, leadId, companyId);
  }

  return minAgent;
}

