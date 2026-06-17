import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { auditLog } from '../middleware/audit';
import { tenantQuotaService } from '../services/tenantQuota.service';
import prisma from '../config/prisma';

const router = Router();

function prismaClient(): any {
  return prisma as any;
}

router.use(authenticate);
router.use(hasRole('super_admin'));

router.get('/overrides', async (_req: AuthRequest, res: Response) => {
  const rows = await prismaClient().companyQuotaOverride.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ data: rows });
});

router.put(
  '/overrides/:companyId',
  auditLog('quota_override_upsert', 'company_quota_override'),
  async (req: AuthRequest, res: Response) => {
    const { companyId } = req.params;
    const { quotas, reason, expiresAt } = req.body || {};

    const row = await prismaClient().companyQuotaOverride.upsert({
      where: { companyId },
      create: {
        companyId,
        quotas: quotas || {},
        reason: reason || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: req.user!.id,
      },
      update: {
        quotas: quotas || {},
        reason: reason || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    tenantQuotaService.invalidateCache(companyId);
    res.json(row);
  },
);

router.delete(
  '/overrides/:companyId',
  auditLog('quota_override_delete', 'company_quota_override'),
  async (req: AuthRequest, res: Response) => {
    const { companyId } = req.params;
    await prismaClient().companyQuotaOverride.deleteMany({ where: { companyId } });
    tenantQuotaService.invalidateCache(companyId);
    res.json({ ok: true });
  },
);

export default router;
