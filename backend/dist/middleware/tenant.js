"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSuperAdminTargetCompanyId = resolveSuperAdminTargetCompanyId;
exports.tenantIsolation = tenantIsolation;
exports.strictTenantIsolation = strictTenantIsolation;
exports.getCompanyId = getCompanyId;
function readTargetCompanyId(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Super-admin tenant scope from query string or JSON body (per-action overrides sidebar context).
 */
function resolveSuperAdminTargetCompanyId(req) {
    const fromQuery = readTargetCompanyId(req.query.target_company_id);
    if (fromQuery)
        return fromQuery;
    const body = req.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        const fromBody = readTargetCompanyId(body.target_company_id);
        if (fromBody)
            return fromBody;
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
 * CRM tenant routes: platform super_admin must pass ?target_company_id=
 * so agency data never resolves to the platform shell company by accident.
 */
function strictTenantIsolation(req, res, next) {
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
        req.companyId = targetCompanyId;
        next();
        return;
    }
    req.companyId = user.company_id;
    next();
}
/**
 * Get the tenant-scoped company_id from the request.
 * Use this in route handlers instead of accessing user.company_id directly.
 */
function getCompanyId(req) {
    return req.companyId || req.user?.company_id;
}
