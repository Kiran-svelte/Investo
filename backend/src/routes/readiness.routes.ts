import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { strictTenantIsolation, getCompanyId } from '../middleware/tenant';
import { hasRole } from '../middleware/rbac';
import { rejectPlatformAdminTenantApi } from '../middleware/rejectPlatformAdmin';
import { getTenantReadiness } from '../services/readiness.service';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);
router.use((req: AuthRequest, res: Response, next) => {
  if (rejectPlatformAdminTenantApi(req, res)) return;
  next();
});
router.use(strictTenantIsolation);

/**
 * GET /api/readiness
 * Tenant self-service readiness checklist (company_admin / super_admin).
 */
router.get(
  '/',
  hasRole('company_admin', 'super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const report = await getTenantReadiness(companyId);
      res.json({ data: report });
    } catch (err: any) {
      logger.error('Failed to compute readiness', { error: err.message });
      res.status(500).json({ error: 'Failed to compute readiness' });
    }
  },
);

export default router;
