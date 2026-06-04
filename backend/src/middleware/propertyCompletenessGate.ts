import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { getUserCatalogCompletenessBlock } from '../services/propertyCompleteness.service';
import logger from '../config/logger';

/**
 * Blocks tenant users with incomplete property imports or published listings
 * until catalog data is complete. Super admins bypass.
 */
const READ_ONLY_CRM_PATH_PREFIXES = [
  '/api/leads',
  '/api/conversations',
  '/api/analytics',
  '/api/error-logs',
  '/api/assignment-settings',
  '/api/readiness',
  '/api/notifications',
  '/api/visits',
];

export async function propertyCompletenessGate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next();
      return;
    }

    if (req.method === 'GET') {
      const path = (req.originalUrl || req.path || '').split('?')[0];
      if (READ_ONLY_CRM_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
        next();
        return;
      }
    }

    if (req.user.role === 'super_admin') {
      next();
      return;
    }

    const companyId = req.user.company_id || req.user.companyId;
    if (!companyId) {
      next();
      return;
    }

    const block = await getUserCatalogCompletenessBlock(companyId, req.user.id);
    if (!block) {
      next();
      return;
    }

    res.status(423).json({
      error: 'Complete your property catalog before continuing',
      code: 'property_catalog_incomplete',
      message: block.promptMessage,
      reasons: block.reasons,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Property completeness gate failed', { error: message });
    res.status(500).json({ error: 'Property catalog check failed' });
  }
}
