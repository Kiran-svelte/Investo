import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { incrementOpsMetric } from '../services/opsMetrics.service';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();
  incrementOpsMetric('http_requests');

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    if (res.statusCode >= 500) incrementOpsMetric('errors_5xx');
    if (res.statusCode === 429) incrementOpsMetric('rate_limited');

    logger[level]('HTTP', {
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs,
    });
  });

  next();
}
