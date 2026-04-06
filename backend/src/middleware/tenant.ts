import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

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
 * Get the tenant-scoped company_id from the request.
 * Use this in route handlers instead of accessing user.company_id directly.
 */
export function getCompanyId(req: AuthRequest): string {
  return (req as any).companyId || req.user?.company_id;
}
