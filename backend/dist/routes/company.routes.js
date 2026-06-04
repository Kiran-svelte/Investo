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
const companyProvisioning_service_1 = require("../services/companyProvisioning.service");
const pagination_1 = require("../utils/pagination");
const sanitize_1 = require("../utils/sanitize");
const whatsappTenantGuard_service_1 = require("../services/whatsappTenantGuard.service");
const resourceDelete_service_1 = require("../services/resourceDelete.service");
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
            const { page, limit, offset } = (0, pagination_1.parsePagination)(req.query);
            const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
            const where = search
                ? {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { slug: { contains: search, mode: 'insensitive' } },
                    ],
                }
                : {};
            const [companies, total] = await Promise.all([
                prisma_1.default.company.findMany({
                    where,
                    include: { plan: true },
                    orderBy: { createdAt: 'desc' },
                    skip: offset,
                    take: limit,
                }),
                prisma_1.default.company.count({ where }),
            ]);
            // Get agent counts per company
            const agentCounts = await prisma_1.default.user.groupBy({
                by: ['companyId'],
                where: { role: 'sales_agent', status: 'active' },
                _count: { id: true },
            });
            const countsMap = new Map(agentCounts.map((c) => [c.companyId, c._count.id]));
            const enriched = companies.map(({ plan, ...c }) => (0, sanitize_1.sanitizeCompanyRecord)({
                ...c,
                plan_name: plan?.name ?? null,
                max_agents: plan?.maxAgents ?? null,
                price_monthly: plan?.priceMonthly ?? null,
                agent_count: countsMap.get(c.id) || 0,
            }));
            res.json({
                data: enriched,
                pagination: (0, pagination_1.buildPaginationMeta)(page, limit, total),
            });
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
            const data = (0, sanitize_1.sanitizeCompanyRecord)({
                ...companyData,
                plan_name: plan?.name ?? null,
                max_agents: plan?.maxAgents ?? null,
                price_monthly: plan?.priceMonthly ?? null,
            });
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
        let resolvedPlanId = plan_id || null;
        if (!resolvedPlanId) {
            const defaultPlan = await prisma_1.default.subscriptionPlan.findFirst({
                orderBy: { priceMonthly: 'asc' },
            });
            resolvedPlanId = defaultPlan?.id ?? null;
        }
        const company = await prisma_1.default.company.create({
            data: {
                name,
                slug,
                whatsappPhone: whatsapp_phone || null,
                planId: resolvedPlanId,
                status: 'active',
            },
        });
        let provisionWarning;
        try {
            await (0, companyProvisioning_service_1.provisionNewCompany)(company.id, company.name);
        }
        catch (provisionErr) {
            const message = provisionErr instanceof Error ? provisionErr.message : String(provisionErr);
            logger_1.default.warn('Company created but provisioning failed', { companyId: company.id, error: message });
            provisionWarning = 'Company created; default settings will finish on next save or onboarding.';
        }
        res.status(201).json({
            data: company,
            id: company.id,
            ...(provisionWarning ? { warning: provisionWarning } : {}),
        });
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
        const existingCompany = await prisma_1.default.company.findFirst({
            where: { id },
            select: { settings: true },
        });
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
            const mergedSettings = settings !== undefined
                ? (0, sanitize_1.mergeSettingsPreservingSecrets)(existingCompany?.settings, settings)
                : undefined;
            if (mergedSettings) {
                const conflict = await (0, whatsappTenantGuard_service_1.assertUniqueMetaPhoneNumberId)(id, mergedSettings);
                if (conflict) {
                    res.status(409).json({ error: conflict });
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
                    ...(mergedSettings !== undefined && {
                        settings: mergedSettings,
                    }),
                },
            });
        }
        else if (req.user.role === 'company_admin' && id === req.user.company_id) {
            // Company admin can only update name and settings of own company
            const { name, settings } = req.body;
            const mergedSettings = settings
                ? (0, sanitize_1.mergeSettingsPreservingSecrets)(existingCompany?.settings, settings)
                : undefined;
            if (mergedSettings) {
                const conflict = await (0, whatsappTenantGuard_service_1.assertUniqueMetaPhoneNumberId)(id, mergedSettings);
                if (conflict) {
                    res.status(409).json({ error: conflict });
                    return;
                }
            }
            await prisma_1.default.company.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(mergedSettings && {
                        settings: mergedSettings,
                    }),
                },
            });
        }
        else {
            res.status(403).json({ error: 'Insufficient permissions' });
            return;
        }
        const updated = await prisma_1.default.company.findFirst({ where: { id } });
        res.json({ data: updated ? (0, sanitize_1.sanitizeCompanyRecord)(updated) : updated });
    }
    catch (err) {
        logger_1.default.error('Failed to update company', { error: err.message });
        res.status(500).json({ error: 'Failed to update company' });
    }
});
/**
 * PATCH /api/companies/:id/deactivate
 * Super admin only. Soft-deactivate a tenant.
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
/**
 * DELETE /api/companies/:id
 * Super admin only. Permanently deletes company and all tenant data.
 */
router.delete('/:id', (0, rbac_1.hasRole)('super_admin'), (0, rbac_1.authorize)('companies', 'delete'), (0, audit_1.auditLog)('delete', 'companies'), async (req, res) => {
    try {
        const { id } = req.params;
        await (0, resourceDelete_service_1.deleteCompanyPermanently)(id);
        res.json({ message: 'Company deleted permanently' });
    }
    catch (err) {
        if (err instanceof resourceDelete_service_1.ResourceDeleteError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        const message = err instanceof Error ? err.message : 'Delete failed';
        logger_1.default.error('Failed to delete company', { error: message });
        res.status(500).json({ error: 'Failed to delete company' });
    }
});
exports.default = router;
