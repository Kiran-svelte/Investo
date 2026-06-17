import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

export class LegalHoldService {
  isEnabled(): boolean {
    return config.features.complianceLegalHold === true;
  }

  async placeHold(input: {
    companyId: string;
    entityType: string;
    entityId: string;
    reason: string;
    placedBy: string;
  }) {
    return prismaClient().legalHold.create({
      data: {
        companyId: input.companyId,
        entityType: input.entityType,
        entityId: input.entityId,
        reason: input.reason,
        placedBy: input.placedBy,
      },
    });
  }

  async releaseHold(companyId: string, holdId: string) {
    return prismaClient().legalHold.updateMany({
      where: { id: holdId, companyId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  }

  async isEntityOnHold(companyId: string, entityType: string, entityId: string): Promise<boolean> {
    if (!this.isEnabled()) return false;

    const count = await prismaClient().legalHold.count({
      where: {
        companyId,
        entityType,
        entityId,
        releasedAt: null,
      },
    });
    return count > 0;
  }

  async listActiveHolds(companyId: string) {
    return prismaClient().legalHold.findMany({
      where: { companyId, releasedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const legalHoldService = new LegalHoldService();
