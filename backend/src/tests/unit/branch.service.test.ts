/// <reference types="jest" />

const mockPrisma = {
  companyBranch: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { BranchService } from '../../identity/org/branch.service';

describe('branch.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates root and child branches', async () => {
    mockPrisma.companyBranch.findFirst.mockResolvedValueOnce({ id: 'root-1', companyId: 'c1' });
    mockPrisma.companyBranch.create
      .mockResolvedValueOnce({
        id: 'root-1',
        companyId: 'c1',
        name: 'HQ',
        parentId: null,
        settings: {},
      })
      .mockResolvedValueOnce({
        id: 'branch-1',
        companyId: 'c1',
        name: 'Andheri',
        parentId: 'root-1',
        settings: {},
      });

    const service = new BranchService();
    const root = await service.create('c1', { name: 'HQ' });
    const child = await service.create('c1', { name: 'Andheri', parent_id: 'root-1' });

    expect(root.name).toBe('HQ');
    expect(child.parent_id).toBe('root-1');
  });

  it('builds a two-level tree', () => {
    const service = new BranchService();
    const tree = service.buildTree([
      { id: 'root', company_id: 'c1', name: 'HQ', parent_id: null, settings: {} },
      { id: 'child', company_id: 'c1', name: 'Andheri', parent_id: 'root', settings: {} },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children![0].name).toBe('Andheri');
  });
});
