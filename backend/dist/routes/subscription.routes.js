"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const audit_1 = require("../middleware/audit");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const invoice_routes_1 = __importDefault(require("./invoice.routes"));
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// Mount invoice routes under /invoices
router.use('/invoices', invoice_routes_1.default);
/**
 * GET /api/subscriptions/plans
 * List all subscription plans.
 * Super admin: all plans
 * Others: active plans only
 */
router.get('/plans', async (req, res) => {
    try {
        const where = {};
        if (req.user.role !== 'super_admin') {
            where.status = 'active';
        }
        const plans = await prisma_1.default.subscriptionPlan.findMany({
            where,
            orderBy: { priceMonthly: 'asc' },
        });
        res.json({ data: plans });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch plans', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch plans' });
    }
});
/**
 * GET /api/subscriptions/plans/:id
 */
router.get('/plans/:id', async (req, res) => {
    try {
        const plan = await prisma_1.default.subscriptionPlan.findFirst({ where: { id: req.params.id } });
        if (!plan) {
            res.status(404).json({ error: 'Plan not found' });
            return;
        }
        res.json({ data: plan });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch plan', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch plan' });
    }
});
/**
 * POST /api/subscriptions/plans
 * Super admin only: create a new subscription plan.
 */
router.post('/plans', (0, rbac_1.hasRole)('super_admin'), (0, audit_1.auditLog)('create', 'subscriptions'), async (req, res) => {
    try {
        const { name, max_agents, max_leads, max_properties, price_monthly, price_yearly, features } = req.body;
        const plan = await prisma_1.default.subscriptionPlan.create({
            data: {
                name,
                maxAgents: max_agents || 3,
                maxLeads: max_leads || null,
                maxProperties: max_properties || null,
                priceMonthly: price_monthly || 0,
                priceYearly: price_yearly || null,
                features: features || [],
                status: 'active',
            },
        });
        res.status(201).json({ data: plan, id: plan.id });
    }
    catch (err) {
        logger_1.default.error('Failed to create plan', { error: err.message });
        res.status(500).json({ error: 'Failed to create plan' });
    }
});
/**
 * PUT /api/subscriptions/plans/:id
 * Super admin only: update a subscription plan.
 */
router.put('/plans/:id', (0, rbac_1.hasRole)('super_admin'), (0, audit_1.auditLog)('update', 'subscriptions'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const updateData = {};
        if (updates.name !== undefined)
            updateData.name = updates.name;
        if (updates.max_agents !== undefined)
            updateData.maxAgents = updates.max_agents;
        if (updates.max_leads !== undefined)
            updateData.maxLeads = updates.max_leads;
        if (updates.max_properties !== undefined)
            updateData.maxProperties = updates.max_properties;
        if (updates.price_monthly !== undefined)
            updateData.priceMonthly = updates.price_monthly;
        if (updates.price_yearly !== undefined)
            updateData.priceYearly = updates.price_yearly;
        if (updates.status !== undefined)
            updateData.status = updates.status;
        if (updates.features)
            updateData.features = updates.features;
        await prisma_1.default.subscriptionPlan.update({
            where: { id },
            data: updateData,
        });
        const plan = await prisma_1.default.subscriptionPlan.findFirst({ where: { id } });
        res.json({ data: plan });
    }
    catch (err) {
        logger_1.default.error('Failed to update plan', { error: err.message });
        res.status(500).json({ error: 'Failed to update plan' });
    }
});
/**
 * DELETE /api/subscriptions/plans/:id
 * Super admin only: deactivate a plan (not delete).
 */
router.delete('/plans/:id', (0, rbac_1.hasRole)('super_admin'), (0, audit_1.auditLog)('deactivate', 'subscriptions'), async (req, res) => {
    try {
        const { id } = req.params;
        // Check if any companies are using this plan
        const companiesUsingPlan = await prisma_1.default.company.count({
            where: { planId: id, status: 'active' },
        });
        if (companiesUsingPlan > 0) {
            res.status(400).json({
                error: 'Cannot deactivate plan with active companies',
                companies_count: companiesUsingPlan,
            });
            return;
        }
        await prisma_1.default.subscriptionPlan.update({
            where: { id },
            data: { status: 'inactive' },
        });
        res.json({ message: 'Plan deactivated' });
    }
    catch (err) {
        logger_1.default.error('Failed to deactivate plan', { error: err.message });
        res.status(500).json({ error: 'Failed to deactivate plan' });
    }
});
/**
 * POST /api/subscriptions/select-plan
 * Company admin: update own company plan.
 * Super admin: update target company plan by company_id.
 */
router.post('/select-plan', (0, rbac_1.hasRole)('super_admin', 'company_admin'), (0, audit_1.auditLog)('update', 'subscriptions'), async (req, res) => {
    try {
        const { plan_id, company_id } = req.body;
        if (!plan_id) {
            res.status(400).json({ error: 'plan_id is required' });
            return;
        }
        const targetCompanyId = req.user.role === 'super_admin'
            ? (company_id || req.user.company_id)
            : req.user.company_id;
        if (!targetCompanyId) {
            res.status(400).json({ error: 'company_id is required for super admin without company context' });
            return;
        }
        const [plan, company] = await Promise.all([
            prisma_1.default.subscriptionPlan.findFirst({ where: { id: plan_id, status: 'active' } }),
            prisma_1.default.company.findFirst({ where: { id: targetCompanyId } }),
        ]);
        if (!plan) {
            res.status(404).json({ error: 'Active plan not found' });
            return;
        }
        if (!company) {
            res.status(404).json({ error: 'Company not found' });
            return;
        }
        await prisma_1.default.company.update({
            where: { id: targetCompanyId },
            data: { planId: plan.id },
        });
        res.json({
            data: {
                company_id: targetCompanyId,
                plan_id: plan.id,
                plan_name: plan.name,
                price_monthly: plan.priceMonthly,
            },
            message: 'Subscription plan updated',
        });
    }
    catch (err) {
        logger_1.default.error('Failed to select subscription plan', { error: err.message });
        res.status(500).json({ error: 'Failed to select subscription plan' });
    }
});
exports.default = router;
