"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const audit_1 = require("../middleware/audit");
const validate_1 = require("../middleware/validate");
const validation_1 = require("../models/validation");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const router = (0, express_1.Router)();
// All company routes require authentication
router.use(auth_1.authenticate);
/**
 * GET /api/companies
 * Super admin: list all companies
 * Others: get own company only
 */
router.get('/', async (req, res) => {
    try {
        if (req.user.role === 'super_admin') {
            const companies = await prisma_1.default.company.findMany({
                include: { plan: true },
                orderBy: { createdAt: 'desc' },
            });
            // Get agent counts per company
            const agentCounts = await prisma_1.default.user.groupBy({
                by: ['companyId'],
                where: { role: 'sales_agent', status: 'active' },
                _count: { id: true },
            });
            const countsMap = new Map(agentCounts.map((c) => [c.companyId, c._count.id]));
            const enriched = companies.map(({ plan, ...c }) => ({
                ...c,
                plan_name: plan?.name ?? null,
                max_agents: plan?.maxAgents ?? null,
                price_monthly: plan?.priceMonthly ?? null,
                agent_count: countsMap.get(c.id) || 0,
            }));
            res.json({ data: enriched, total: enriched.length });
        }
        else {
            const company = await prisma_1.default.company.findFirst({
                where: { id: req.user.company_id },
                include: { plan: true },
            });
            if (!company) {
                res.json({ data: null });
                return;
            }
            const { plan, ...companyData } = company;
            const data = {
                ...companyData,
                plan_name: plan?.name ?? null,
                max_agents: plan?.maxAgents ?? null,
                price_monthly: plan?.priceMonthly ?? null,
            };
            res.json({ data });
        }
    }
    catch (err) {
        logger_1.default.error('Failed to fetch companies', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});
/**
 * GET /api/companies/:id
 * Super admin: any company
 * Others: own company only
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Non-super_admin can only view own company
        if (req.user.role !== 'super_admin' && id !== req.user.company_id) {
            res.status(403).json({ error: 'Cannot access other companies' });
            return;
        }
        const company = await prisma_1.default.company.findFirst({
            where: { id },
            include: { plan: true },
        });
        if (!company) {
            res.status(404).json({ error: 'Company not found' });
            return;
        }
        const { plan, ...companyData } = company;
        const data = {
            ...companyData,
            plan_name: plan?.name ?? null,
            max_agents: plan?.maxAgents ?? null,
            price_monthly: plan?.priceMonthly ?? null,
        };
        res.json({ data });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch company', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch company' });
    }
});
/**
 * POST /api/companies
 * Super admin only: create a new company.
 */
router.post('/', (0, rbac_1.hasRole)('super_admin'), (0, validate_1.validate)(validation_1.createCompanySchema), (0, audit_1.auditLog)('create', 'companies'), async (req, res) => {
    try {
        const { name, slug, whatsapp_phone, plan_id } = req.body;
        // Check slug uniqueness
        const existingSlug = await prisma_1.default.company.findUnique({ where: { slug } });
        if (existingSlug) {
            res.status(409).json({ error: 'Company slug already exists' });
            return;
        }
        // Check whatsapp_phone uniqueness (globally)
        if (whatsapp_phone) {
            const existingPhone = await prisma_1.default.company.findUnique({ where: { whatsappPhone: whatsapp_phone } });
            if (existingPhone) {
                res.status(409).json({ error: 'WhatsApp number already in use by another company' });
                return;
            }
        }
        const company = await prisma_1.default.company.create({
            data: {
                name,
                slug,
                whatsappPhone: whatsapp_phone || null,
                planId: plan_id || null,
                status: 'active',
            },
        });
        res.status(201).json({ data: company, id: company.id });
    }
    catch (err) {
        logger_1.default.error('Failed to create company', { error: err.message });
        res.status(500).json({ error: 'Failed to create company' });
    }
});
/**
 * PUT /api/companies/:id
 * Super admin: update any company
 * Company admin: update own company (limited fields)
 */
router.put('/:id', (0, audit_1.auditLog)('update', 'companies'), async (req, res) => {
    try {
        const { id } = req.params;
        if (req.user.role === 'super_admin') {
            // Super admin can update everything including settings
            const { name, slug, whatsapp_phone, plan_id, status, settings } = req.body;
            let normalizedWhatsAppPhone = undefined;
            if (whatsapp_phone !== undefined) {
                const normalized = (0, validation_1.normalizeIndianPhoneNumber)(whatsapp_phone);
                if (normalized === null) {
                    normalizedWhatsAppPhone = null;
                }
                else if (typeof normalized === 'string' && (0, validation_1.isIndianE164Phone)(normalized)) {
                    normalizedWhatsAppPhone = normalized;
                }
                else {
                    res.status(400).json({ error: 'Phone must be in E.164 format: +91XXXXXXXXXX' });
                    return;
                }
            }
            // Validate slug uniqueness if changing
            if (slug) {
                const existing = await prisma_1.default.company.findFirst({ where: { slug, NOT: { id } } });
                if (existing) {
                    res.status(409).json({ error: 'Slug already in use' });
                    return;
                }
            }
            // Validate whatsapp_phone uniqueness if changing
            if (normalizedWhatsAppPhone) {
                const existing = await prisma_1.default.company.findFirst({ where: { whatsappPhone: normalizedWhatsAppPhone, NOT: { id } } });
                if (existing) {
                    res.status(409).json({ error: 'WhatsApp number already in use' });
                    return;
                }
            }
            await prisma_1.default.company.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(slug && { slug }),
                    ...(whatsapp_phone !== undefined && { whatsappPhone: normalizedWhatsAppPhone }),
                    ...(plan_id !== undefined && { planId: plan_id }),
                    ...(status && { status }),
                    ...(settings !== undefined && { settings }),
                },
            });
        }
        else if (req.user.role === 'company_admin' && id === req.user.company_id) {
            // Company admin can only update name and settings of own company
            const { name, settings } = req.body;
            await prisma_1.default.company.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(settings && { settings }),
                },
            });
        }
        else {
            res.status(403).json({ error: 'Insufficient permissions' });
            return;
        }
        const updated = await prisma_1.default.company.findFirst({ where: { id } });
        res.json({ data: updated });
    }
    catch (err) {
        logger_1.default.error('Failed to update company', { error: err.message });
        res.status(500).json({ error: 'Failed to update company' });
    }
});
/**
 * PATCH /api/companies/:id/deactivate
 * Super admin only. Companies cannot be deleted, only deactivated.
 */
router.patch('/:id/deactivate', (0, rbac_1.hasRole)('super_admin'), (0, audit_1.auditLog)('deactivate', 'companies'), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.default.company.update({
            where: { id },
            data: { status: 'inactive' },
        });
        res.json({ message: 'Company deactivated' });
    }
    catch (err) {
        logger_1.default.error('Failed to deactivate company', { error: err.message });
        res.status(500).json({ error: 'Failed to deactivate company' });
    }
});
/**
 * PATCH /api/companies/:id/activate
 * Super admin only.
 */
router.patch('/:id/activate', (0, rbac_1.hasRole)('super_admin'), (0, audit_1.auditLog)('activate', 'companies'), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.default.company.update({
            where: { id },
            data: { status: 'active' },
        });
        res.json({ message: 'Company activated' });
    }
    catch (err) {
        logger_1.default.error('Failed to activate company', { error: err.message });
        res.status(500).json({ error: 'Failed to activate company' });
    }
});
exports.default = router;
//# sourceMappingURL=company.routes.js.map