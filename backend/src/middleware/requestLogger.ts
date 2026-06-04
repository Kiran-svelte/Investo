import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import type winston from 'winston';
import logger, { createCorrelatedLogger } from '../config/logger';
import { incrementOpsMetric, recordLatency } from '../services/opsMetrics.service';

const SLOW_REQUEST_MS = 500;

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-request-id'] as string) || randomUUID();
  (req as Request & { requestId?: string; correlationId?: string }).requestId = correlationId;
  (req as Request & { correlationId?: string }).correlationId = correlationId;
  (req as Request & { log?: winston.Logger }).log = createCorrelatedLogger(correlationId);
  res.setHeader('X-Request-Id', correlationId);

  const start = Date.now();
  incrementOpsMetric('http_requests');

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    recordLatency(durationMs);

    const path = req.originalUrl.split('?')[0];
    const level = res.statusCode >= 500
      ? 'error'
      : res.statusCode >= 400 || durationMs >= SLOW_REQUEST_MS
        ? 'warn'
        : 'info';

    if (res.statusCode >= 500) incrementOpsMetric('errors_5xx');
    if (res.statusCode === 429) incrementOpsMetric('rate_limited');

    const user = (req as Request & { user?: { id?: string } }).user;
    const payload = {
      correlationId,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 120),
      userId: user?.id,
    };

    if (durationMs >= SLOW_REQUEST_MS) {
      incrementOpsMetric('slow_requests');
      logger.warn('Slow HTTP request', payload);
    } else {
      logger[level]('HTTP', payload);
    }
  });

  next();
}
