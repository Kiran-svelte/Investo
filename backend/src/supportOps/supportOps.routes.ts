import { Router, Response } from 'express';

import config from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { impersonationService } from './impersonation.service';
import { tenantHealthService } from './tenantHealth.service';

const router = Router();

router.use(authenticate);

router.get('/health/:companyId', hasRole('super_admin'), async (req: AuthRequest, res: Response) => {
  const latest = await tenantHealthService.getLatest(req.params.companyId);
  res.json({ health: latest, enabled: tenantHealthService.isEnabled() });
});

router.post('/health/:companyId/compute', hasRole('super_admin'), async (req: AuthRequest, res: Response) => {
  if (!config.features.supportOps) {
    res.status(503).json({ error: 'FEATURE_SUPPORT_OPS is disabled' });
    return;
  }
  try {
    const health = await tenantHealthService.computeAndStore(req.params.companyId);
    res.status(201).json({ health });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/impersonate', hasRole('super_admin'), async (req: AuthRequest, res: Response) => {
  if (!config.features.supportOps) {
    res.status(503).json({ error: 'FEATURE_SUPPORT_OPS is disabled' });
    return;
  }
  const supportUserId = req.user?.id;
  if (!supportUserId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { company_id, target_user_id, ticket_id, ttl_minutes } = req.body || {};
  if (!company_id || !target_user_id || !ticket_id) {
    res.status(400).json({ error: 'company_id, target_user_id, and ticket_id are required' });
    return;
  }

  try {
    const session = await impersonationService.startImpersonation({
      companyId: company_id,
      supportUserId,
      targetUserId: target_user_id,
      ticketId: ticket_id,
      ttlMinutes: ttl_minutes,
    });
    res.status(201).json({ session });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/impersonate/:id/revoke', hasRole('super_admin'), async (req: AuthRequest, res: Response) => {
  const supportUserId = req.user?.id;
  const companyId = req.body?.company_id;
  if (!supportUserId || !companyId) {
    res.status(400).json({ error: 'company_id required' });
    return;
  }
  const result = await impersonationService.revokeImpersonation(companyId, req.params.id, supportUserId);
  res.json({ revoked: result.count > 0 });
});

export default router;
