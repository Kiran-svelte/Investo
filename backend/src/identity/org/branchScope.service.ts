import config from '../../config';
import prisma from '../../config/prisma';

const EMPTY_AGENT_SENTINEL = '00000000-0000-0000-0000-000000000000';

export function isOrgBranchesEnabled(): boolean {
  return config.features.orgBranches === true;
}

export async function resolveBranchIdsInScope(companyId: string, branchId: string): Promise<string[]> {
  const branches = await prisma.companyBranch.findMany({
    where: { companyId },
    select: { id: true, parentId: true },
  });
  const ids = new Set<string>([branchId]);
  for (const branch of branches) {
    if (branch.parentId === branchId) {
      ids.add(branch.id);
    }
  }
  return [...ids];
}

export async function resolveAgentUserIdsForBranch(companyId: string, branchId: string): Promise<string[]> {
  const branchIds = await resolveBranchIdsInScope(companyId, branchId);
  const users = await prisma.user.findMany({
    where: {
      companyId,
      branchId: { in: branchIds },
      status: 'active',
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

export function resolveEffectiveBranchId(
  user: { role: string; branch_id?: string | null },
  queryBranchId?: string | null,
): string | null {
  if (!isOrgBranchesEnabled()) {
    return null;
  }
  if (user.role === 'company_admin' && queryBranchId) {
    return queryBranchId;
  }
  if (['operations', 'viewer'].includes(user.role) && user.branch_id) {
    return user.branch_id;
  }
  return null;
}

export async function applyAssignedAgentBranchScope(
  where: Record<string, unknown>,
  companyId: string,
  user: { id: string; role: string; branch_id?: string | null },
  queryBranchId?: string | null,
): Promise<void> {
  if (!isOrgBranchesEnabled()) {
    return;
  }
  if (user.role === 'sales_agent') {
    return;
  }

  const branchId = resolveEffectiveBranchId(user, queryBranchId);
  if (!branchId) {
    return;
  }

  const agentIds = await resolveAgentUserIdsForBranch(companyId, branchId);
  where.assignedAgentId = {
    in: agentIds.length > 0 ? agentIds : [EMPTY_AGENT_SENTINEL],
  };
}

export async function applyVisitAgentBranchScope(
  where: Record<string, unknown>,
  companyId: string,
  user: { id: string; role: string; branch_id?: string | null },
  queryBranchId?: string | null,
): Promise<void> {
  if (!isOrgBranchesEnabled()) {
    return;
  }
  if (user.role === 'sales_agent') {
    return;
  }

  const branchId = resolveEffectiveBranchId(user, queryBranchId);
  if (!branchId) {
    return;
  }

  const agentIds = await resolveAgentUserIdsForBranch(companyId, branchId);
  where.agentId = {
    in: agentIds.length > 0 ? agentIds : [EMPTY_AGENT_SENTINEL],
  };
}

export async function assertBranchBelongsToCompany(companyId: string, branchId: string): Promise<void> {
  const branch = await prisma.companyBranch.findFirst({
    where: { id: branchId, companyId },
    select: { id: true },
  });
  if (!branch) {
    throw new Error('Branch not found');
  }
}

export async function countBranchMembers(companyId: string, branchIds: string[]): Promise<Map<string, number>> {
  if (branchIds.length === 0) {
    return new Map();
  }
  const rows = await prisma.user.groupBy({
    by: ['branchId'],
    where: {
      companyId,
      branchId: { in: branchIds },
      status: 'active',
    },
    _count: { id: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.branchId) {
      counts.set(row.branchId, row._count.id);
    }
  }
  return counts;
}
