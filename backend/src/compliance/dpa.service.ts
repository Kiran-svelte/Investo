import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

export const CURRENT_DPA_VERSION = '2026.06.17';

export class DpaService {
  isEnabled(): boolean {
    return config.features.complianceDpa === true;
  }

  async acceptDpa(companyId: string, acceptedBy: string, version = CURRENT_DPA_VERSION) {
    return prismaClient().dpaAcceptance.create({
      data: { companyId, acceptedBy, version },
    });
  }

  async getLatestAcceptance(companyId: string) {
    return prismaClient().dpaAcceptance.findFirst({
      where: { companyId },
      orderBy: { acceptedAt: 'desc' },
    });
  }

  async hasAcceptedCurrentVersion(companyId: string): Promise<boolean> {
    if (!this.isEnabled()) return true;
    const latest = await this.getLatestAcceptance(companyId);
    return latest?.version === CURRENT_DPA_VERSION;
  }
}

export const dpaService = new DpaService();
