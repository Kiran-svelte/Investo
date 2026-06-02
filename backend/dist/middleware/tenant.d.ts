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
export declare function tenantIsolation(req: AuthRequest, res: Response, next: NextFunction): void;
/**
 * Get the tenant-scoped company_id from the request.
 * Use this in route handlers instead of accessing user.company_id directly.
 */
export declare function getCompanyId(req: AuthRequest): string;
//# sourceMappingURL=tenant.d.ts.map