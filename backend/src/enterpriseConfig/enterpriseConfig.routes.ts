import { Router, Response } from 'express';

import config from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { getCompanyId, strictTenantIsolation } from '../middleware/tenant';
import { sandboxService } from './sandbox.service';
import { approvalChainService, type ApprovalChainType } from './approvalChain.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin', 'super_admin'));
router.use(strictTenantIsolation);

router.get('/sandbox', async (req: AuthRequest, res: Response) => {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const sandbox = await sandboxService.getSandbox(companyId);
  res.json({ sandbox, enabled: sandboxService.isEnabled() });
});

router.post('/sandbox', async (req: AuthRequest, res: Response) => {
  if (!config.features.sandboxTenants) {
    res.status(503).json({ error: 'FEATURE_SANDBOX_TENANTS is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const { sandbox_company_id } = req.body || {};
  if (!sandbox_company_id) {
    res.status(400).json({ error: 'sandbox_company_id is required' });
    return;
  }
  try {
    const sandbox = await sandboxService.createSandbox(companyId, sandbox_company_id);
    res.status(201).json({ sandbox });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/approval-chains/:chainType', async (req: AuthRequest, res: Response) => {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const chainType = req.params.chainType as ApprovalChainType;
  const steps = await approvalChainService.getChain(companyId, chainType);
  res.json({ chain_type: chainType, steps, enabled: approvalChainService.isEnabled() });
});

router.put('/approval-chains/:chainType', async (req: AuthRequest, res: Response) => {
  if (!config.features.approvalChains) {
    res.status(503).json({ error: 'FEATURE_APPROVAL_CHAINS is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const chainType = req.params.chainType as ApprovalChainType;
  const steps = req.body?.steps;
  if (!Array.isArray(steps)) {
    res.status(400).json({ error: 'steps[] is required' });
    return;
  }
  try {
    const company = await approvalChainService.upsertChain(companyId, chainType, steps);
    const settings = company.settings as Record<string, unknown>;
    res.json({ company_id: company.id, chain_type: chainType, steps: settings[`approval_chain_${chainType}`] });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
