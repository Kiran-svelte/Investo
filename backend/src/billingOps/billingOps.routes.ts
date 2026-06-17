import { Router, Response } from 'express';

import config from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { meteringInvoiceService } from './meteringInvoice.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin', 'super_admin'));

router.get('/invoices', async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const invoices = await meteringInvoiceService.listInvoices(companyId);
  res.json({ invoices, enabled: meteringInvoiceService.isEnabled() });
});

router.post('/invoices/generate', async (req: AuthRequest, res: Response) => {
  if (!config.features.billingOps) {
    res.status(503).json({ error: 'FEATURE_BILLING_OPS is disabled' });
    return;
  }
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }

  const { period_start, period_end } = req.body || {};
  if (!period_start || !period_end) {
    res.status(400).json({ error: 'period_start and period_end are required (ISO dates)' });
    return;
  }

  try {
    const invoice = await meteringInvoiceService.generateInvoice(
      companyId,
      new Date(period_start),
      new Date(period_end),
    );
    res.status(201).json({ invoice });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/allowances', (_req: AuthRequest, res: Response) => {
  res.json({ allowances: meteringInvoiceService.getIncludedAllowances() });
});

export default router;
