import prisma from '../config/prisma';

const ASSIGNABLE_LEAD_AGENT_ROLES = ['sales_agent'] as const;

export type TenantAgentValidationResult =
  | { ok: true; agentId: string }
  | { ok: false; reason: 'missing_agent_id' | 'agent_not_in_company' };

/**
 * Ensure a lead assignment target belongs to the same tenant and is an active sales agent.
 */
export async function assertActiveLeadAgentInCompany(
  companyId: string,
  agentId: string | null | undefined,
): Promise<TenantAgentValidationResult> {
  if (!agentId) {
    return { ok: false, reason: 'missing_agent_id' };
  }

  const agent = await prisma.user.findFirst({
    where: {
      id: agentId,
      companyId,
      role: { in: [...ASSIGNABLE_LEAD_AGENT_ROLES] },
      status: 'active',
    },
    select: { id: true },
  });

  if (!agent) {
    return { ok: false, reason: 'agent_not_in_company' };
  }

  return { ok: true, agentId: agent.id };
}

/**
 * Verify an agent user belongs to the same company as a business record.
 */
export async function assertUserBelongsToCompany(
  companyId: string,
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId, status: 'active' },
    select: { id: true },
  });
  return Boolean(user);
}
