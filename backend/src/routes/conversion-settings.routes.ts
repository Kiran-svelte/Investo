import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { rejectPlatformAdminTenantApi } from '../middleware/rejectPlatformAdmin';
import logger from '../config/logger';
import {
  getConversionSettings,
  saveConversionSettings,
  type ConversionPartner,
  type ConversionSettingsPatch,
} from '../services/conversionSettings.service';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const partnerSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  contact_phone: z.string().max(20).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

const conversionSettingsSchema = z.object({
  budget_stretch_percent: z.number().min(5).max(50).optional(),
  upsell_enabled: z.boolean().optional(),
  waitlist_copy: z
    .object({
      en: z.string().min(1).max(2000).optional(),
      hi: z.string().max(2000).optional(),
      kn: z.string().max(2000).optional(),
    })
    .optional(),
  partners: z.array(partnerSchema).optional(),
});

router.use(authenticate);
router.use(tenantIsolation);
router.use((req: AuthRequest, res: Response, next: NextFunction) => {
  if (rejectPlatformAdminTenantApi(req, res)) return;
  next();
});
router.use(requireFeature('ai_bot'));

router.get(
  '/',
  authorize('ai_settings', 'read'),
  async (req: AuthRequest, res: Response) => {
    if (rejectPlatformAdminTenantApi(req, res)) return;
    try {
      const data = await getConversionSettings(getCompanyId(req));
      res.json({ data });
    } catch (err: any) {
      logger.error('Failed to fetch conversion settings', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch conversion settings' });
    }
  },
);

router.put(
  '/',
  authorize('ai_settings', 'update'),
  validate(conversionSettingsSchema),
  auditLog('update', 'ai_settings'),
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as z.infer<typeof conversionSettingsSchema>;
      const patch: ConversionSettingsPatch = {};

      if (body.budget_stretch_percent !== undefined) {
        patch.budget_stretch_percent = body.budget_stretch_percent;
      }
      if (body.upsell_enabled !== undefined) {
        patch.upsell_enabled = body.upsell_enabled;
      }
      if (body.waitlist_copy) {
        patch.waitlist_copy = body.waitlist_copy;
      }
      if (body.partners) {
        patch.partners = body.partners.map(
          (p): ConversionPartner => ({
            id: p.id || uuidv4(),
            name: p.name,
            contact_phone: p.contact_phone ?? null,
            notes: p.notes ?? null,
            active: p.active !== false,
          }),
        );
      }

      const data = await saveConversionSettings(getCompanyId(req), patch);
      res.json({ data });
    } catch (err: any) {
      logger.error('Failed to update conversion settings', { error: err.message });
      res.status(500).json({ error: 'Failed to update conversion settings' });
    }
  },
);

export default router;
