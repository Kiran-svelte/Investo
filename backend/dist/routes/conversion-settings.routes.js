"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const audit_1 = require("../middleware/audit");
const validate_1 = require("../middleware/validate");
const featureGate_1 = require("../middleware/featureGate");
const logger_1 = __importDefault(require("../config/logger"));
const conversionSettings_service_1 = require("../services/conversionSettings.service");
const uuid_1 = require("uuid");
const router = (0, express_1.Router)();
const partnerSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).optional(),
    name: zod_1.z.string().min(1).max(200),
    contact_phone: zod_1.z.string().max(20).nullable().optional(),
    notes: zod_1.z.string().max(2000).nullable().optional(),
    active: zod_1.z.boolean().optional(),
});
const conversionSettingsSchema = zod_1.z.object({
    budget_stretch_percent: zod_1.z.number().min(5).max(50).optional(),
    upsell_enabled: zod_1.z.boolean().optional(),
    waitlist_copy: zod_1.z
        .object({
        en: zod_1.z.string().min(1).max(2000).optional(),
        hi: zod_1.z.string().max(2000).optional(),
        kn: zod_1.z.string().max(2000).optional(),
    })
        .optional(),
    partners: zod_1.z.array(partnerSchema).optional(),
});
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
router.use((0, featureGate_1.requireFeature)('ai_bot'));
router.get('/', (0, rbac_1.authorize)('ai_settings', 'read'), async (req, res) => {
    try {
        const data = await (0, conversionSettings_service_1.getConversionSettings)((0, tenant_1.getCompanyId)(req));
        res.json({ data });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch conversion settings', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch conversion settings' });
    }
});
router.put('/', (0, rbac_1.authorize)('ai_settings', 'update'), (0, validate_1.validate)(conversionSettingsSchema), (0, audit_1.auditLog)('update', 'ai_settings'), async (req, res) => {
    try {
        const body = req.body;
        const patch = {};
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
            patch.partners = body.partners.map((p) => ({
                id: p.id || (0, uuid_1.v4)(),
                name: p.name,
                contact_phone: p.contact_phone ?? null,
                notes: p.notes ?? null,
                active: p.active !== false,
            }));
        }
        const data = await (0, conversionSettings_service_1.saveConversionSettings)((0, tenant_1.getCompanyId)(req), patch);
        res.json({ data });
    }
    catch (err) {
        logger_1.default.error('Failed to update conversion settings', { error: err.message });
        res.status(500).json({ error: 'Failed to update conversion settings' });
    }
});
exports.default = router;
