/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: { orgBranches: true },
  },
}));

const mockPrisma = {
  companyBranch: {
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import {
  applyAssignedAgentBranchScope,
  isOrgBranchesEnabled,
  resolveBranchIdsInScope,
  resolveEffectiveBranchId,
} from '../../identity/org/branchScope.service';

describe('branchScope.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports org branches enabled from config', () => {
    expect(isOrgBranchesEnabled()).toBe(true);
  });

  it('includes child branch ids in scope', async () => {
    mockPrisma.companyBranch.findMany.mockResolvedValue([
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
      { id: 'other-root', parentId: null },
    ]);

    const ids = await resolveBranchIdsInScope('company-1', 'root');
    expect(ids.sort()).toEqual(['child', 'root'].sort());
  });

  it('scopes operations user to branch agents', async () => {
    mockPrisma.companyBranch.findMany.mockResolvedValue([{ id: 'root', parentId: null }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'agent-1' }, { id: 'agent-2' }]);

    const where: Record<string, unknown> = { companyId: 'company-1' };
    await applyAssignedAgentBranchScope(
      where,
      'company-1',
      { id: 'ops-1', role: 'operations', branch_id: 'root' },
      resolveEffectiveBranchId({ role: 'operations', branch_id: 'root' }),
    );

    expect(where.assignedAgentId).toEqual({ in: ['agent-1', 'agent-2'] });
  });

  it('allows company admin branch filter via query param', () => {
    expect(
      resolveEffectiveBranchId({ role: 'company_admin', branch_id: null }, 'branch-a'),
    ).toBe('branch-a');
  });
});
