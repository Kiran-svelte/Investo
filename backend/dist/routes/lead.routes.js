"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapLeadToSnakeCaseDTO = mapLeadToSnakeCaseDTO;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const audit_1 = require("../middleware/audit");
const validate_1 = require("../middleware/validate");
const featureGate_1 = require("../middleware/featureGate");
const rateLimiter_1 = require("../middleware/rateLimiter");
const subscriptionEnforcement_1 = require("../middleware/subscriptionEnforcement");
const validation_1 = require("../models/validation");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const notification_engine_1 = require("../services/notification.engine");
const socket_service_1 = require("../services/socket.service");
const router = (0, express_1.Router)();
function toIsoString(value) {
    return value ? value.toISOString() : null;
}
function toNullableNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'number')
        return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value?.toNumber === 'function') {
        return value.toNumber();
    }
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
}
function stringifyDetails(details) {
    if (details === null || details === undefined)
        return null;
    if (typeof details === 'string')
        return details;
    try {
        return JSON.stringify(details);
    }
    catch {
        return String(details);
    }
}
function mapLeadToSnakeCaseDTO(lead) {
    return {
        id: lead.id,
        customer_name: lead.customerName,
        phone: lead.phone,
        email: lead.email,
        budget_min: toNullableNumber(lead.budgetMin),
        budget_max: toNullableNumber(lead.budgetMax),
        location_preference: lead.locationPreference,
        property_type: lead.propertyType,
        status: lead.status,
        source: lead.source,
        assigned_agent_id: lead.assignedAgentId,
        agent_name: lead.assignedAgent?.name || null,
        notes: lead.notes,
        language: lead.language || 'en',
        created_at: toIsoString(lead.createdAt),
        updated_at: toIsoString(lead.updatedAt),
        last_contact_at: toIsoString(lead.lastContactAt),
        conversation_id: lead.conversations?.[0]?.id || null,
    };
}
function mapLeadTimelineToSnakeCaseDTO(entry) {
    return {
        id: entry.id,
        action: entry.action,
        resource_type: entry.resourceType,
        details: stringifyDetails(entry.details),
        performed_by: entry.userId,
        created_at: toIsoString(entry.createdAt),
    };
}
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
router.use((0, featureGate_1.requireFeature)('lead_automation'));
/**
 * GET /api/leads
 * List leads. Sales agents see only assigned leads.
 */
router.get('/', (0, rbac_1.authorize)('leads', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const where = { companyId };
        // Sales agent: only assigned leads
        if (req.user.role === 'sales_agent') {
            where.assignedAgentId = req.user.id;
        }
        // Filters
        const { status, assigned_agent_id, property_type, search, sort_by, sort_order } = req.query;
        if (status)
            where.status = status;
        if (assigned_agent_id)
            where.assignedAgentId = assigned_agent_id;
        if (property_type)
            where.propertyType = property_type;
        if (search) {
            where.OR = [
                { customerName: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
            ];
        }
        // Sorting
        const sortFieldMap = {
            created_at: 'createdAt',
            updated_at: 'updatedAt',
            customer_name: 'customerName',
            status: 'status',
            budget_min: 'budgetMin',
            budget_max: 'budgetMax',
        };
        const sortField = sortFieldMap[sort_by || 'created_at'] || 'createdAt';
        const sortDir = sort_order === 'asc' ? 'asc' : 'desc';
        // Pagination
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const offset = (page - 1) * limit;
        const [leads, total] = await Promise.all([
            prisma_1.default.lead.findMany({
                where,
                include: {
                    assignedAgent: { select: { name: true } },
                    conversations: { select: { id: true }, take: 1 }
                },
                orderBy: { [sortField]: sortDir },
                skip: offset,
                take: limit,
            }),
            prisma_1.default.lead.count({ where }),
        ]);
        const data = leads.map((lead) => mapLeadToSnakeCaseDTO(lead));
        res.json({
            data,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch leads', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
});
/**
 * GET /api/leads/:id
 */
router.get('/:id', (0, rbac_1.authorize)('leads', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const where = { id, companyId };
        // Sales agent: only if assigned
        if (req.user.role === 'sales_agent') {
            where.assignedAgentId = req.user.id;
        }
        const lead = await prisma_1.default.lead.findFirst({
            where,
            include: {
                assignedAgent: { select: { name: true } },
                conversations: { select: { id: true }, take: 1 }
            },
        });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }
        // Get lead timeline (audit logs for this lead)
        const timeline = await prisma_1.default.auditLog.findMany({
            where: { companyId, resourceType: 'leads', resourceId: id },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        res.json({
            data: {
                ...mapLeadToSnakeCaseDTO(lead),
                timeline: timeline.map((entry) => mapLeadTimelineToSnakeCaseDTO(entry)),
            },
        });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch lead', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch lead' });
    }
});
/**
 * POST /api/leads
 * Create a new lead. Always starts with status 'new'.
 */
router.post('/', (0, rbac_1.authorize)('leads', 'create'), subscriptionEnforcement_1.requireActivePaidSubscription, (0, subscriptionEnforcement_1.enforcePlanLimit)('leads'), (0, validate_1.validate)(validation_1.createLeadSchema), (0, audit_1.auditLog)('create', 'leads'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        // After Zod validation, req.body uses snake_case field names
        let agentId = req.body.assigned_agent_id;
        if (!agentId) {
            agentId = await assignLeadRoundRobin(companyId);
        }
        const lead = await prisma_1.default.lead.create({
            data: {
                companyId,
                customerName: req.body.customer_name || null,
                phone: req.body.phone,
                email: req.body.email || null,
                budgetMin: req.body.budget_min || null,
                budgetMax: req.body.budget_max || null,
                locationPreference: req.body.location_preference || null,
                propertyType: req.body.property_type || null,
                source: req.body.source || 'manual',
                assignedAgentId: agentId || null,
                status: 'new',
                notes: req.body.notes || null,
                language: req.body.language || 'en',
            },
        });
        if (lead.assignedAgentId) {
            await notification_engine_1.notificationEngine.onLeadAssigned(lead, lead.assignedAgentId);
        }
        // Emit WebSocket event for real-time update
        socket_service_1.socketService.emitToCompany(companyId, socket_service_1.SOCKET_EVENTS.LEAD_CREATED, {
            lead: { ...lead, companyId: undefined }, // Don't expose companyId to frontend
        });
        res.status(201).json({ data: mapLeadToSnakeCaseDTO(lead), id: lead.id });
    }
    catch (err) {
        logger_1.default.error('Failed to create lead', { error: err.message });
        res.status(500).json({ error: 'Failed to create lead' });
    }
});
/**
 * PUT /api/leads/:id
 * Update lead fields (not status - use PATCH for that).
 */
router.put('/:id', (0, rbac_1.authorize)('leads', 'update'), (0, audit_1.auditLog)('update', 'leads'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const lead = await prisma_1.default.lead.findFirst({ where: { id, companyId } });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }
        // Sales agent can only update assigned leads
        if (req.user.role === 'sales_agent' && lead.assignedAgentId !== req.user.id) {
            res.status(403).json({ error: 'Can only update assigned leads' });
            return;
        }
        const { customer_name, email, budget_min, budget_max, location_preference, property_type, assigned_agent_id, notes, language } = req.body;
        const oldAgentId = lead.assignedAgentId;
        const updated = await prisma_1.default.lead.update({
            where: { id },
            data: {
                ...(customer_name !== undefined && { customerName: customer_name }),
                ...(email !== undefined && { email }),
                ...(budget_min !== undefined && { budgetMin: budget_min }),
                ...(budget_max !== undefined && { budgetMax: budget_max }),
                ...(location_preference !== undefined && { locationPreference: location_preference }),
                ...(property_type !== undefined && { propertyType: property_type }),
                ...(assigned_agent_id !== undefined && { assignedAgentId: assigned_agent_id }),
                ...(notes !== undefined && { notes }),
                ...(language !== undefined && { language }),
                lastContactAt: new Date(),
            },
        });
        if (assigned_agent_id !== undefined && assigned_agent_id !== oldAgentId) {
            if (assigned_agent_id) {
                await notification_engine_1.notificationEngine.onLeadReassigned(updated, oldAgentId, assigned_agent_id);
                // Emit socket event for lead assignment
                socket_service_1.socketService.emitToUser(assigned_agent_id, socket_service_1.SOCKET_EVENTS.LEAD_ASSIGNED, {
                    lead: { ...updated, companyId: undefined },
                });
            }
        }
        // Emit WebSocket event for lead update
        socket_service_1.socketService.emitToCompany(companyId, socket_service_1.SOCKET_EVENTS.LEAD_UPDATED, {
            lead: { ...updated, companyId: undefined },
        });
        const updatedWithAgent = await prisma_1.default.lead.findUnique({
            where: { id: updated.id },
            include: { assignedAgent: { select: { name: true } } },
        });
        res.json({ data: mapLeadToSnakeCaseDTO(updatedWithAgent || updated) });
    }
    catch (err) {
        logger_1.default.error('Failed to update lead', { error: err.message });
        res.status(500).json({ error: 'Failed to update lead' });
    }
});
/**
 * PATCH /api/leads/:id/status
 * Transition lead status. Enforces state machine.
 * Leads CANNOT be deleted - only closed.
 */
router.patch('/:id/status', (0, rbac_1.authorize)('leads', 'update'), (0, validate_1.validate)(validation_1.updateLeadStatusSchema), (0, audit_1.auditLog)('status_change', 'leads'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const { id } = req.params;
        const { status: newStatus } = req.body;
        const lead = await prisma_1.default.lead.findFirst({ where: { id, companyId } });
        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }
        // Sales agent can only update assigned leads
        if (req.user.role === 'sales_agent' && lead.assignedAgentId !== req.user.id) {
            res.status(403).json({ error: 'Can only update assigned leads' });
            return;
        }
        const currentStatus = lead.status;
        const targetStatus = newStatus;
        // Special case: only company_admin can reopen closed_lost -> contacted
        if (currentStatus === 'closed_lost' && targetStatus === 'contacted') {
            if (req.user.role !== 'company_admin' && req.user.role !== 'super_admin') {
                res.status(403).json({ error: 'Only company admin can reopen closed leads' });
                return;
            }
            // Allow this transition
        }
        else if (!(0, validation_1.isValidTransition)(validation_1.LEAD_TRANSITIONS, currentStatus, targetStatus)) {
            res.status(400).json({
                error: `Invalid status transition: ${currentStatus} -> ${targetStatus}`,
                allowed: validation_1.LEAD_TRANSITIONS[currentStatus],
            });
            return;
        }
        const updated = await prisma_1.default.lead.update({
            where: { id },
            data: {
                status: targetStatus,
                lastContactAt: new Date(),
            },
        });
        await notification_engine_1.notificationEngine.onLeadStatusChange(lead, currentStatus, targetStatus);
        res.json({ data: mapLeadToSnakeCaseDTO(updated) });
    }
    catch (err) {
        logger_1.default.error('Failed to update lead status', { error: err.message });
        res.status(500).json({ error: 'Failed to update lead status' });
    }
});
/**
 * POST /api/leads/import/csv
 * Bulk import leads from CSV. Company admin only.
 * Expected CSV format: name,phone,email,budget_min,budget_max,location,property_type,source
 */
router.post('/import/csv', (0, rbac_1.authorize)('leads', 'create'), (0, audit_1.auditLog)('bulk_import', 'leads'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        if (req.user.role !== 'company_admin' && req.user.role !== 'super_admin') {
            res.status(403).json({ error: 'Only admins can import data' });
            return;
        }
        const { csv_data } = req.body;
        if (!csv_data || typeof csv_data !== 'string') {
            res.status(400).json({ error: 'csv_data is required as a string' });
            return;
        }
        // Parse CSV
        const lines = csv_data.trim().split('\n');
        if (lines.length < 2) {
            res.status(400).json({ error: 'CSV must have headers and at least one data row' });
            return;
        }
        // Parse headers (lowercase, trim)
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
        const requiredHeaders = ['phone'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        if (missingHeaders.length > 0) {
            res.status(400).json({ error: `Missing required headers: ${missingHeaders.join(', ')}` });
            return;
        }
        // Parse rows
        const results = {
            success: 0,
            failed: 0,
            errors: [],
            leads: [],
        };
        const validPropertyTypes = ['apartment', 'villa', 'plot', 'commercial', 'penthouse'];
        const validSources = ['whatsapp', 'website', 'referral', 'facebook', 'google', 'walk_in', 'other'];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line)
                continue;
            try {
                // Handle CSV with quotes
                const values = parseCSVLine(line);
                const row = {};
                headers.forEach((h, idx) => {
                    row[h] = values[idx]?.trim() || '';
                });
                // Validate phone
                const phone = row.phone?.replace(/[^0-9+]/g, '');
                if (!phone || phone.length < 10) {
                    results.failed++;
                    results.errors.push({ row: i + 1, error: 'Invalid phone number' });
                    continue;
                }
                // Check for duplicate phone in this company
                const existing = await prisma_1.default.lead.findFirst({
                    where: { companyId, phone },
                });
                if (existing) {
                    results.failed++;
                    results.errors.push({ row: i + 1, error: `Duplicate phone: ${phone}` });
                    continue;
                }
                // Parse values
                const propertyType = row.property_type?.toLowerCase();
                const source = row.source?.toLowerCase();
                const leadData = {
                    companyId,
                    phone,
                    customerName: row.name || row.customer_name || null,
                    email: row.email || null,
                    budgetMin: row.budget_min ? parseFloat(row.budget_min.replace(/[^0-9.]/g, '')) : null,
                    budgetMax: row.budget_max ? parseFloat(row.budget_max.replace(/[^0-9.]/g, '')) : null,
                    locationPreference: row.location || row.location_preference || null,
                    propertyType: validPropertyTypes.includes(propertyType) ? propertyType : null,
                    source: validSources.includes(source) ? source : 'other',
                    status: 'new',
                };
                // Auto-assign agent using round-robin
                const assignedAgentId = await assignLeadRoundRobin(companyId);
                if (assignedAgentId) {
                    leadData.assignedAgentId = assignedAgentId;
                }
                const lead = await prisma_1.default.lead.create({ data: leadData });
                results.success++;
                results.leads.push(lead);
                // Emit socket event
                socket_service_1.socketService.emitToCompany(companyId, socket_service_1.SOCKET_EVENTS.LEAD_CREATED, {
                    lead: { ...lead, companyId: undefined },
                });
                // Notify assigned agent
                if (assignedAgentId) {
                    await notification_engine_1.notificationEngine.onLeadAssigned(lead, assignedAgentId);
                    socket_service_1.socketService.emitToUser(assignedAgentId, socket_service_1.SOCKET_EVENTS.LEAD_ASSIGNED, {
                        lead: { ...lead, companyId: undefined },
                    });
                }
            }
            catch (err) {
                results.failed++;
                results.errors.push({ row: i + 1, error: err.message });
            }
        }
        logger_1.default.info('Bulk lead import completed', {
            companyId,
            userId: req.user.id,
            success: results.success,
            failed: results.failed,
        });
        res.json({
            message: `Imported ${results.success} leads, ${results.failed} failed`,
            success: results.success,
            failed: results.failed,
            errors: results.errors.slice(0, 50), // Limit error output
        });
    }
    catch (err) {
        logger_1.default.error('Failed to import leads', { error: err.message });
        res.status(500).json({ error: 'Failed to import leads' });
    }
});
/**
 * Parse CSV line handling quoted values
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        }
        else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        }
        else {
            current += char;
        }
    }
    result.push(current);
    return result;
}
/**
 * GET /api/leads/import/template
 * Download CSV template for bulk import
 */
router.get('/import/template', (0, rbac_1.authorize)('leads', 'create'), async (_req, res) => {
    const template = 'name,phone,email,budget_min,budget_max,location,property_type,source\n' +
        'John Doe,+919876543210,john@email.com,5000000,10000000,Mumbai,apartment,website\n' +
        'Jane Smith,9123456789,jane@email.com,3000000,7000000,Pune,villa,referral';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=lead_import_template.csv');
    res.send(template);
});
/**
 * GET /api/leads/export/csv
 * Export leads as CSV. Company admin only.
 * Rate limited: 10 exports per hour per user
 */
router.get('/export/csv', (0, rbac_1.authorize)('leads', 'read'), rateLimiter_1.exportRateLimiter, (0, audit_1.auditLog)('export', 'leads'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        if (req.user.role !== 'company_admin' && req.user.role !== 'super_admin') {
            res.status(403).json({ error: 'Only admins can export data' });
            return;
        }
        const leads = await prisma_1.default.lead.findMany({
            where: { companyId },
            include: { assignedAgent: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
        });
        // Build CSV
        const headers = ['Name', 'Phone', 'Email', 'Budget Min', 'Budget Max', 'Location', 'Type', 'Status', 'Agent', 'Source', 'Created'];
        const rows = leads.map((l) => [
            l.customerName || '', l.phone, l.email || '',
            l.budgetMin || '', l.budgetMax || '', l.locationPreference || '',
            l.propertyType || '', l.status, l.assignedAgent?.name || '', l.source || '',
            l.createdAt,
        ].join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=leads_export.csv');
        res.send(csv);
    }
    catch (err) {
        logger_1.default.error('Failed to export leads', { error: err.message });
        res.status(500).json({ error: 'Failed to export leads' });
    }
});
/**
 * Round-robin agent assignment
 */
async function assignLeadRoundRobin(companyId) {
    // Get all active sales agents for this company
    const agents = await prisma_1.default.user.findMany({
        where: { companyId, role: 'sales_agent', status: 'active' },
        select: { id: true },
    });
    if (agents.length === 0)
        return null;
    // Count active leads per agent
    const leadCounts = await prisma_1.default.lead.groupBy({
        by: ['assignedAgentId'],
        where: {
            companyId,
            status: { notIn: ['closed_won', 'closed_lost'] },
            assignedAgentId: { in: agents.map((a) => a.id) },
        },
        _count: { id: true },
    });
    const countMap = new Map(leadCounts.map((l) => [l.assignedAgentId, l._count.id]));
    // Find agent with least leads
    let minAgent = agents[0].id;
    let minCount = countMap.get(agents[0].id) || 0;
    for (const agent of agents) {
        const count = countMap.get(agent.id) || 0;
        if (count < minCount) {
            minCount = count;
            minAgent = agent.id;
        }
    }
    return minAgent;
}
exports.default = router;
//# sourceMappingURL=lead.routes.js.map