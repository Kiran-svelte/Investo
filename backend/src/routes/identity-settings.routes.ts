import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { getCompanyIdentityConfig, upsertCompanyIdentityConfig } from '../identity/identityConfig.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin'));

router.get('/identity', async (req: AuthRequest, res: Response) => {
  const config = await getCompanyIdentityConfig(req.user!.company_id);
  res.json({ data: config });
});

router.put('/identity', async (req: AuthRequest, res: Response) => {
  try {
    const result = await upsertCompanyIdentityConfig(req.user!.company_id, {
      sso_enabled: req.body?.sso_enabled,
      sso_provider: req.body?.sso_provider,
      sso_oidc_issuer: req.body?.sso_oidc_issuer,
      sso_oidc_client_id: req.body?.sso_oidc_client_id,
      sso_oidc_client_secret: req.body?.sso_oidc_client_secret,
      scim_enabled: req.body?.scim_enabled,
      mfa_required: req.body?.mfa_required,
      mfa_methods: req.body?.mfa_methods,
      allowed_domains: req.body?.allowed_domains,
      ip_allowlist_enabled: req.body?.ip_allowlist_enabled,
      ip_allowlist: req.body?.ip_allowlist,
      rotate_scim_token: req.body?.rotate_scim_token === true,
    });
    res.json({ data: result.config, scim_token_plain: result.scim_token_plain || null });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update identity settings' });
  }
});

export default router;
