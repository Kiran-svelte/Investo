import prisma from '../config/prisma';
import logger from '../config/logger';
import type { QuotaDimension } from '../constants/quotaDefaults';

function prismaClient(): any {
  return prisma as any;
}

function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export class TenantUsageService {
  async recordMetric(companyId: string, dimension: QuotaDimension, amount: number): Promise<void> {
    const date = startOfUtcDay();
    const existing = await prismaClient().tenantUsageDaily.findUnique({
      where: { companyId_date: { companyId, date } },
    });

    const metrics = (existing?.metrics as Record<string, number> | null) || {};
    metrics[dimension] = (metrics[dimension] || 0) + amount;

    await prismaClient().tenantUsageDaily.upsert({
      where: { companyId_date: { companyId, date } },
      create: {
        companyId,
        date,
        metrics,
      },
      update: {
        metrics,
      },
    });
  }

  async rollupFromCounters(
    companyId: string,
    counters: Partial<Record<QuotaDimension, number>>,
  ): Promise<void> {
    try {
      for (const [dimension, amount] of Object.entries(counters)) {
        if (!amount || amount <= 0) continue;
        await this.recordMetric(companyId, dimension as QuotaDimension, amount);
      }
    } catch (err) {
      logger.error('Tenant usage rollup failed', {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const tenantUsageService = new TenantUsageService();
