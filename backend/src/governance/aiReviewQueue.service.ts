import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

const RISK_THRESHOLD = 70;

export class AiReviewQueueService {
  isEnabled(): boolean {
    return config.features.aiReviewQueue === true;
  }

  getRiskThreshold(): number {
    return RISK_THRESHOLD;
  }

  async enqueue(input: {
    companyId: string;
    messageId: string;
    riskScore: number;
  }) {
    if (!this.isEnabled()) return null;

    if (input.riskScore < RISK_THRESHOLD) {
      return null;
    }

    return prismaClient().aiReviewQueueItem.create({
      data: {
        companyId: input.companyId,
        messageId: input.messageId,
        riskScore: input.riskScore,
        status: 'pending',
      },
    });
  }

  async listPending(companyId: string) {
    return prismaClient().aiReviewQueueItem.findMany({
      where: { companyId, status: 'pending' },
      orderBy: { riskScore: 'desc' },
    });
  }

  async review(itemId: string, companyId: string, reviewedBy: string, status: 'approved' | 'rejected') {
    return prismaClient().aiReviewQueueItem.updateMany({
      where: { id: itemId, companyId, status: 'pending' },
      data: { status, reviewedBy, updatedAt: new Date() },
    });
  }
}

export const aiReviewQueueService = new AiReviewQueueService();
