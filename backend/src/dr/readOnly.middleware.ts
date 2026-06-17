import { Request, Response, NextFunction } from 'express';

import { readOnlyModeService } from './readOnlyMode.service';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const READ_ONLY_ALLOW_PREFIXES = [
  '/api/health',
  '/api/readiness',
  '/api/metrics',
  '/api/status',
  '/api/auth',
  '/api/webhook',
];

export function readOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!readOnlyModeService.isEnabled()) {
    next();
    return;
  }

  if (!MUTATION_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const path = req.originalUrl.split('?')[0];
  if (READ_ONLY_ALLOW_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    next();
    return;
  }

  res.status(503).json({
    error: 'read_only_mode',
    message: readOnlyModeService.getReason(),
  });
}
