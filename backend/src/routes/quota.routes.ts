import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { tenantQuotaService } from '../services/tenantQuota.service';
import { QUOTA_DIMENSION_LABELS } from '../constants/quotaDefaults';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin', 'super_admin'));

router.get('/usage', async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }

  const snapshot = await tenantQuotaService.getUsageSnapshot(companyId);
  res.json({
    tier: snapshot.tier,
    limits: snapshot.limits,
    usage: snapshot.usage,
    labels: QUOTA_DIMENSION_LABELS,
    enforcement: {
      enabled: tenantQuotaService.isEnabled(),
      hard: tenantQuotaService.isHardEnforce(),
    },
  });
});

export default router;
