"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const tenant_1 = require("../middleware/tenant");
const rbac_1 = require("../middleware/rbac");
const readiness_service_1 = require("../services/readiness.service");
const logger_1 = __importDefault(require("../config/logger"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
/**
 * GET /api/readiness
 * Tenant self-service readiness checklist (company_admin / super_admin).
 */
router.get('/', (0, rbac_1.hasRole)('company_admin', 'super_admin'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const report = await (0, readiness_service_1.getTenantReadiness)(companyId);
        res.json({ data: report });
    }
    catch (err) {
        logger_1.default.error('Failed to compute readiness', { error: err.message });
        res.status(500).json({ error: 'Failed to compute readiness' });
    }
});
exports.default = router;
