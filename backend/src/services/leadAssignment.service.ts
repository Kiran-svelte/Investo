import prisma from '../config/prisma';

/**
 * Assign lead to sales agent with fewest active (non-terminal) leads.
 */
export async function assignLeadRoundRobin(companyId: string): Promise<string | null> {
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
  let minCount = countMap.get(agents[0].id) || 0;
  for (const agent of agents) {
    const count = countMap.get(agent.id) || 0;
    if (count < minCount) {
      minCount = count;
      minAgent = agent.id;
    }
  }

  return minAgent;
}
