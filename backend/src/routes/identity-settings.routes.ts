import { Router, Response } from 'express';

import config from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { getCompanyIdentityConfig, upsertCompanyIdentityConfig } from '../identity/identityConfig.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin'));

function buildPlatformFeatures() {
  return {
    sso: config.features.sso === true && config.keycloak.enabled === true && Boolean(config.keycloak.baseUrl),
    mfa: config.features.mfa === true,
    scim: config.features.scim === true,
    ip_allowlist: config.features.ipAllowlist === true,
  };
}

router.get('/identity', async (req: AuthRequest, res: Response) => {
  const identityConfig = await getCompanyIdentityConfig(req.user!.company_id);
  res.json({ data: identityConfig, platform_features: buildPlatformFeatures() });
});

router.put('/identity', async (req: AuthRequest, res: Response) => {
  try {
    const result = await upsertCompanyIdentityConfig(req.user!.company_id, {
      scim_enabled: req.body?.scim_enabled,
      mfa_required: req.body?.mfa_required,
      mfa_methods: req.body?.mfa_methods,
      allowed_domains: req.body?.allowed_domains,
      ip_allowlist_enabled: req.body?.ip_allowlist_enabled,
      ip_allowlist: req.body?.ip_allowlist,
      rotate_scim_token: req.body?.rotate_scim_token === true,
    });
    res.json({ data: result.config, scim_token_plain: result.scim_token_plain || null, platform_features: buildPlatformFeatures() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update identity settings' });
  }
});

export default router;
