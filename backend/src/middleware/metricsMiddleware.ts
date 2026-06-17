import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

import config from '../config';
import {
  recordHttpRequestMetrics,
  recordWebhookAckMetrics,
} from '../services/prometheusMetrics.service';

export function hashCompanyId(companyId: string | null | undefined): string {
  if (!companyId) return 'public';
  return crypto.createHash('sha256').update(companyId).digest('hex').slice(0, 12);
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.observability.metricsEnabled || !config.features.prometheusMetrics) {
    next();
    return;
  }

  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const path = req.originalUrl.split('?')[0];
    const user = (req as Request & { user?: { company_id?: string; companyId?: string } }).user;
    const companyIdHash = hashCompanyId(user?.company_id || user?.companyId);

    recordHttpRequestMetrics(req.method, path, res.statusCode, durationMs, companyIdHash);

    if (req.method.toUpperCase() === 'POST' && path === '/api/webhook') {
      recordWebhookAckMetrics(res.statusCode, durationMs);
    }
  });

  next();
}
