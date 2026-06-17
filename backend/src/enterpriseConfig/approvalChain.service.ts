import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

export type ApprovalChainType = 'property_publish' | 'visit_book' | 'discount';

export interface ApprovalStep {
  role: string;
  order: number;
  timeout_hours?: number;
}

export class ApprovalChainService {
  isEnabled(): boolean {
    return config.features.approvalChains === true;
  }

  private settingsKey(chainType: ApprovalChainType): string {
    return `approval_chain_${chainType}`;
  }

  async getChain(companyId: string, chainType: ApprovalChainType): Promise<ApprovalStep[]> {
    const company = await prismaClient().company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const settings = (company?.settings as Record<string, unknown>) || {};
    const key = this.settingsKey(chainType);
    const chain = settings[key];
    return Array.isArray(chain) ? (chain as ApprovalStep[]) : [];
  }

  async upsertChain(companyId: string, chainType: ApprovalChainType, steps: ApprovalStep[]) {
    if (!this.isEnabled()) {
      throw new Error('Approval chains feature is disabled');
    }

    const company = await prismaClient().company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const settings = { ...((company?.settings as Record<string, unknown>) || {}) };
    settings[this.settingsKey(chainType)] = steps;

    return prismaClient().company.update({
      where: { id: companyId },
      data: { settings },
      select: { id: true, settings: true },
    });
  }

  async evaluateApproval(companyId: string, chainType: ApprovalChainType, actorRole: string): Promise<boolean> {
    const steps = await this.getChain(companyId, chainType);
    if (steps.length === 0) return true;
    const first = steps.sort((a, b) => a.order - b.order)[0];
    return first.role === actorRole || actorRole === 'super_admin' || actorRole === 'company_admin';
  }
}

export const approvalChainService = new ApprovalChainService();
