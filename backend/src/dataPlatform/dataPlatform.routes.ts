import { Router, Response } from 'express';

import config from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { getCompanyId, strictTenantIsolation } from '../middleware/tenant';
import { outboxService } from './outbox.service';
import { tenantSearchService } from './tenantSearch.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin', 'super_admin'));

router.post('/outbox/process', hasRole('super_admin'), async (_req: AuthRequest, res: Response) => {
  const processed = await outboxService.processPending();
  res.json({ processed });
});

router.use(strictTenantIsolation);

router.get('/search', async (req: AuthRequest, res: Response) => {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const results = await tenantSearchService.search(companyId, q);
  res.json({ results, enabled: tenantSearchService.isEnabled() });
});

router.get('/outbox', async (req: AuthRequest, res: Response) => {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const events = await outboxService.listEvents(companyId, status);
  res.json({ events, enabled: outboxService.isEnabled() });
});

router.post('/outbox', async (req: AuthRequest, res: Response) => {
  if (!config.features.outboxEvents) {
    res.status(503).json({ error: 'FEATURE_OUTBOX_EVENTS is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const { event_type, payload } = req.body || {};
  if (!event_type) {
    res.status(400).json({ error: 'event_type is required' });
    return;
  }
  try {
    const event = await outboxService.publish({
      companyId,
      eventType: event_type,
      payload: payload || {},
    });
    res.status(201).json({ event });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
