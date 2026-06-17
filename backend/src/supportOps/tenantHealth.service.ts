import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

export interface TenantHealthSignals {
  quota_warnings: number;
  open_dsr: number;
  pending_ai_reviews: number;
  failed_webhooks: number;
}

export class TenantHealthService {
  isEnabled(): boolean {
    return config.features.supportOps === true;
  }

  computeScore(signals: TenantHealthSignals): number {
    let score = 100;
    score -= signals.quota_warnings * 5;
    score -= signals.open_dsr * 3;
    score -= signals.pending_ai_reviews * 2;
    score -= signals.failed_webhooks * 4;
    return Math.max(0, Math.min(100, score));
  }

  async collectSignals(companyId: string): Promise<TenantHealthSignals> {
    const [openDsr, pendingReviews] = await Promise.all([
      prismaClient().dataSubjectRequest.count({
        where: { companyId, status: { in: ['pending', 'processing'] } },
      }).catch(() => 0),
      prismaClient().aiReviewQueueItem.count({
        where: { companyId, status: 'pending' },
      }).catch(() => 0),
    ]);

    return {
      quota_warnings: 0,
      open_dsr: openDsr,
      pending_ai_reviews: pendingReviews,
      failed_webhooks: 0,
    };
  }

  async computeAndStore(companyId: string) {
    if (!this.isEnabled()) {
      throw new Error('Support ops feature is disabled');
    }

    const signals = await this.collectSignals(companyId);
    const score = this.computeScore(signals);

    return prismaClient().tenantHealthScore.create({
      data: {
        companyId,
        score,
        signals,
        computedAt: new Date(),
      },
    });
  }

  async getLatest(companyId: string) {
    return prismaClient().tenantHealthScore.findFirst({
      where: { companyId },
      orderBy: { computedAt: 'desc' },
    });
  }
}

export const tenantHealthService = new TenantHealthService();
