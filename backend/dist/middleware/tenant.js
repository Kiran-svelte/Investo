"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantIsolation = tenantIsolation;
exports.getCompanyId = getCompanyId;
/**
 * Tenant isolation middleware.
 * Injects company_id into query context so all downstream DB queries
 * are automatically scoped to the current user's company.
 *
 * INVARIANT: Every database query MUST include company_id filter.
 * Super admins can optionally specify a company_id via query param for admin operations.
 */
function tenantIsolation(req, res, next) {
    const user = req.user;
    if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    // Super admin can target a specific company
    if (user.role === 'super_admin' && req.query.target_company_id) {
        req.companyId = req.query.target_company_id;
    }
    else {
        // CRITICAL: Always use server-side company_id, never trust client
        req.companyId = user.company_id;
    }
    next();
}
/**
 * Get the tenant-scoped company_id from the request.
 * Use this in route handlers instead of accessing user.company_id directly.
 */
function getCompanyId(req) {
    return req.companyId || req.user?.company_id;
}
//# sourceMappingURL=tenant.js.map