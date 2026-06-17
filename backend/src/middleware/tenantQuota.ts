import { Response, NextFunction } from 'express';

import config from '../config';
import { AuthRequest } from './auth';
import { tenantQuotaService } from '../services/tenantQuota.service';
import type { QuotaDimension } from '../constants/quotaDefaults';

export function requireQuota(dimension: QuotaDimension, amount = 1) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!config.features.tenantQuotas) {
      next();
      return;
    }

    const companyId = req.user?.company_id;
    if (!companyId) {
      next();
      return;
    }

    const result = await tenantQuotaService.consume(companyId, dimension, amount);

    if (result.warnOnly) {
      res.setHeader('X-Quota-Warning', `${dimension}:${result.used}/${result.limit}`);
    }

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      res.status(429).json({
        error: 'Usage limit reached for your plan. Contact your administrator to upgrade.',
        dimension,
        limit: result.limit,
        used: result.used,
        retryAfter: result.retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

export async function checkAiQuota(companyId: string, tokenEstimate = 1): Promise<void> {
  if (!config.features.tenantQuotas) return;

  const callResult = await tenantQuotaService.consume(companyId, 'ai_call_hour', 1);
  if (!callResult.allowed && config.features.quotaHardEnforce) {
    const err = new Error('AI usage limit reached for your plan.');
    (err as any).statusCode = 429;
    (err as any).quota = callResult;
    throw err;
  }

  if (tokenEstimate > 0) {
    const tokenResult = await tenantQuotaService.consume(companyId, 'ai_tokens_day', tokenEstimate);
    if (!tokenResult.allowed && config.features.quotaHardEnforce) {
      const err = new Error('Daily AI token limit reached for your plan.');
      (err as any).statusCode = 429;
      (err as any).quota = tokenResult;
      throw err;
    }
  }
}
