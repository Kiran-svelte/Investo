import { v4 as uuidv4 } from 'uuid';

import prisma from '../../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

export interface BranchNode {
  id: string;
  company_id: string;
  name: string;
  parent_id: string | null;
  settings: Record<string, unknown>;
  children?: BranchNode[];
}

export class BranchService {
  async list(companyId: string): Promise<BranchNode[]> {
    const rows = await prismaClient().companyBranch.findMany({
      where: { companyId },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row: any) => this.normalize(row));
  }

  async create(companyId: string, input: { name: string; parent_id?: string | null; settings?: Record<string, unknown> }): Promise<BranchNode> {
    if (input.parent_id) {
      const parent = await prismaClient().companyBranch.findFirst({
        where: { id: input.parent_id, companyId },
      });
      if (!parent) throw new Error('Parent branch not found');
    }

    const row = await prismaClient().companyBranch.create({
      data: {
        id: uuidv4(),
        companyId,
        name: input.name.trim(),
        parentId: input.parent_id || null,
        settings: input.settings || {},
      },
    });
    return this.normalize(row);
  }

  async update(companyId: string, branchId: string, input: { name?: string; parent_id?: string | null; settings?: Record<string, unknown> }): Promise<BranchNode> {
    const existing = await prismaClient().companyBranch.findFirst({
      where: { id: branchId, companyId },
    });
    if (!existing) throw new Error('Branch not found');

    if (input.parent_id === branchId) {
      throw new Error('Branch cannot be its own parent');
    }

    const row = await prismaClient().companyBranch.update({
      where: { id: branchId },
      data: {
        name: input.name?.trim() || existing.name,
        parentId: input.parent_id === undefined ? existing.parentId : input.parent_id,
        settings: input.settings === undefined ? existing.settings : input.settings,
      },
    });
    return this.normalize(row);
  }

  async remove(companyId: string, branchId: string): Promise<void> {
    const childCount = await prismaClient().companyBranch.count({
      where: { companyId, parentId: branchId },
    });
    if (childCount > 0) {
      throw new Error('Cannot delete branch with child branches');
    }

    await prismaClient().companyBranch.deleteMany({
      where: { id: branchId, companyId },
    });
  }

  buildTree(branches: BranchNode[]): BranchNode[] {
    const byId = new Map<string, BranchNode>();
    for (const branch of branches) {
      byId.set(branch.id, { ...branch, children: [] });
    }
    const roots: BranchNode[] = [];
    for (const branch of byId.values()) {
      if (branch.parent_id && byId.has(branch.parent_id)) {
        byId.get(branch.parent_id)!.children!.push(branch);
      } else {
        roots.push(branch);
      }
    }
    return roots;
  }

  private normalize(row: any): BranchNode {
    return {
      id: row.id,
      company_id: row.companyId,
      name: row.name,
      parent_id: row.parentId,
      settings: (row.settings as Record<string, unknown>) || {},
    };
  }
}

export const branchService = new BranchService();
