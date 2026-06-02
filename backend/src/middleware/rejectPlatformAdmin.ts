import { Response } from 'express';
import { AuthRequest } from './auth';

const TENANT_SETTINGS_MESSAGE =
  'Platform admins manage agencies under Companies. Tenant settings are configured by each agency Company Admin.';

/**
 * Block super_admin from tenant-scoped settings APIs (features, roles, conversion, onboarding setup).
 */
export function rejectPlatformAdminTenantApi(req: AuthRequest, res: Response): boolean {
  if (req.user?.role === 'super_admin') {
    res.status(403).json({ error: TENANT_SETTINGS_MESSAGE });
    return true;
  }
  return false;
}
