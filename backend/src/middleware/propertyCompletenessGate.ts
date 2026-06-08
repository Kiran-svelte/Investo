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
  '/api/calendar',
];

/** Mutations on existing bookings must work even when the property catalog is incomplete. */
const OPERATIONAL_BOOKING_MUTATION = /^\/api\/visits\/[^/]+(?:\/status)?$/;

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

    const path = (req.originalUrl || req.path || '').split('?')[0];

    if (req.method === 'GET') {
      if (READ_ONLY_CRM_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
        next();
        return;
      }
    }

    // Confirm / reschedule / cancel existing visits — not catalog-dependent.
    if (['PATCH', 'PUT', 'DELETE'].includes(req.method) && OPERATIONAL_BOOKING_MUTATION.test(path)) {
      next();
      return;
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
