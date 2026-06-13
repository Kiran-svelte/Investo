import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

function readTargetCompanyId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Super-admin tenant scope from query string or JSON body (per-action overrides sidebar context).
 */
export function resolveSuperAdminTargetCompanyId(req: AuthRequest): string {
  const fromQuery = readTargetCompanyId(req.query.target_company_id);
  if (fromQuery) return fromQuery;

  const body = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const fromBody = readTargetCompanyId((body as Record<string, unknown>).target_company_id);
    if (fromBody) return fromBody;
  }

  return '';
}

/**
 * Tenant isolation middleware.
 * Injects company_id into query context so all downstream DB queries
 * are automatically scoped to the current user's company.
 *
 * INVARIANT: Every database query MUST include company_id filter.
 * Super admins can optionally specify a company_id via query param for admin operations.
 */
export function tenantIsolation(req: AuthRequest, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Super admin can target a specific company
  if (user.role === 'super_admin' && req.query.target_company_id) {
    (req as any).companyId = req.query.target_company_id as string;
  } else {
    // CRITICAL: Always use server-side company_id, never trust client
    (req as any).companyId = user.company_id;
  }

  next();
}

/**
 * CRM tenant routes: platform super_admin must pass ?target_company_id=
 * so agency data never resolves to the platform shell company by accident.
 */
export function strictTenantIsolation(req: AuthRequest, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (user.role === 'super_admin') {
    const targetCompanyId = resolveSuperAdminTargetCompanyId(req);
    if (!targetCompanyId) {
      res.status(400).json({
        error: 'Select a tenant company before accessing agency data (target_company_id query parameter).',
      });
      return;
    }
    (req as any).companyId = targetCompanyId;
    next();
    return;
  }

  (req as any).companyId = user.company_id;
  next();
}

/**
 * Get the tenant-scoped company_id from the request.
 * Use this in route handlers instead of accessing user.company_id directly.
 */
export function getCompanyId(req: AuthRequest): string {
  return (req as any).companyId || req.user?.company_id;
}
