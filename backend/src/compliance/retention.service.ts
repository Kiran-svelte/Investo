import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';

function prismaClient(): any {
  return prisma as any;
}

const DEFAULT_POLICY = {
  leadDays: 2555,
  messageDays: 1095,
  auditDays: 2555,
  inactiveCompanyDays: 90,
};

export class RetentionService {
  isEnabled(): boolean {
    return config.features.complianceRetention === true;
  }

  async getPolicy(companyId: string) {
    const existing = await prismaClient().retentionPolicy.findUnique({
      where: { companyId },
    });
    return existing || { companyId, ...DEFAULT_POLICY };
  }

  async upsertPolicy(
    companyId: string,
    policy: Partial<typeof DEFAULT_POLICY>,
  ) {
    return prismaClient().retentionPolicy.upsert({
      where: { companyId },
      create: { companyId, ...DEFAULT_POLICY, ...policy },
      update: policy,
    });
  }

  async runNightlyPurge(companyId: string): Promise<{ purged: Record<string, number> }> {
    if (!this.isEnabled()) {
      return { purged: {} };
    }

    const policy = await this.getPolicy(companyId);
    const purged: Record<string, number> = {};
    const messageCutoff = new Date(Date.now() - policy.messageDays * 86_400_000);

    try {
      const deletedMessages = await prismaClient().message.deleteMany({
        where: {
          conversation: { companyId },
          createdAt: { lt: messageCutoff },
        },
      });
      purged.messages = deletedMessages.count;
    } catch (err) {
      logger.error('Retention purge failed for messages', {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { purged };
  }
}

export const retentionService = new RetentionService();
