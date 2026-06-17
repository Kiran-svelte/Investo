import config from '../config';
import prisma from '../config/prisma';
import { QUOTA_TIER_DEFAULTS, type QuotaDimension } from '../constants/quotaDefaults';

function prismaClient(): any {
  return prisma as any;
}

const INR_RATES: Partial<Record<QuotaDimension, number>> = {
  ai_call_hour: 2.5,
  whatsapp_outbound_min: 0.5,
  ai_tokens_day: 0.0001,
  api_requests_min: 0.01,
};

export interface InvoiceLineItem {
  dimension: string;
  quantity: number;
  unit_price_inr: number;
  amount_inr: number;
}

export class MeteringInvoiceService {
  isEnabled(): boolean {
    return config.features.billingOps === true;
  }

  async aggregateUsage(companyId: string, periodStart: Date, periodEnd: Date): Promise<InvoiceLineItem[]> {
    const rows = await prismaClient().tenantUsageDaily.findMany({
      where: {
        companyId,
        date: { gte: periodStart, lte: periodEnd },
      },
    });

    const totals: Record<string, number> = {};
    for (const row of rows) {
      const metrics = (row.metrics as Record<string, number>) || {};
      for (const [dimension, qty] of Object.entries(metrics)) {
        totals[dimension] = (totals[dimension] || 0) + qty;
      }
    }

    return Object.entries(totals).map(([dimension, quantity]) => {
      const unitPrice = INR_RATES[dimension as QuotaDimension] ?? 1;
      const amount = quantity * unitPrice;
      return {
        dimension,
        quantity,
        unit_price_inr: unitPrice,
        amount_inr: amount,
      };
    });
  }

  async generateInvoice(companyId: string, periodStart: Date, periodEnd: Date) {
    if (!this.isEnabled()) {
      throw new Error('Billing ops feature is disabled');
    }

    const lineItems = await this.aggregateUsage(companyId, periodStart, periodEnd);
    const totalInr = lineItems.reduce((sum, item) => sum + item.amount_inr, 0);

    return prismaClient().usageInvoice.upsert({
      where: {
        companyId_periodStart_periodEnd: {
          companyId,
          periodStart,
          periodEnd,
        },
      },
      create: {
        companyId,
        periodStart,
        periodEnd,
        totalInr: totalInr.toFixed(2),
        lineItems,
        status: 'draft',
      },
      update: {
        totalInr: totalInr.toFixed(2),
        lineItems,
      },
    });
  }

  async listInvoices(companyId: string) {
    return prismaClient().usageInvoice.findMany({
      where: { companyId },
      orderBy: { periodStart: 'desc' },
    });
  }

  getIncludedAllowances(): typeof QUOTA_TIER_DEFAULTS.starter {
    return QUOTA_TIER_DEFAULTS.starter;
  }
}

export const meteringInvoiceService = new MeteringInvoiceService();
