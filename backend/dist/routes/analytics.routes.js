"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const featureGate_1 = require("../middleware/featureGate");
const propertyCompletenessGate_1 = require("../middleware/propertyCompletenessGate");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const redis_1 = require("../config/redis");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
router.use(propertyCompletenessGate_1.propertyCompletenessGate);
router.use((0, featureGate_1.requireFeature)('analytics'));
/**
 * GET /api/analytics/dashboard
 * Get dashboard statistics for the company.
 */
router.get('/dashboard', (0, rbac_1.authorize)('analytics', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const cacheKey = `dashboard:${companyId}`;
        // Check Redis cache first (60s TTL)
        const cached = await (0, redis_1.cacheGet)(cacheKey);
        if (cached) {
            logger_1.default.info('Dashboard served from Redis cache', { companyId });
            res.json({ data: cached, cached: true, cacheType: (0, redis_1.getCacheType)() });
            return;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const [leadsToday, leadsTotal, visitsScheduled, visitsCompleted, dealsClosed, aiConversations, revenueResult] = await Promise.all([
            // Leads today
            prisma_1.default.lead.count({
                where: { companyId, createdAt: { gte: today } },
            }),
            // Total leads
            prisma_1.default.lead.count({
                where: { companyId },
            }),
            // Visits scheduled (upcoming)
            prisma_1.default.visit.count({
                where: {
                    companyId,
                    status: { in: ['scheduled', 'confirmed'] },
                    scheduledAt: { gte: new Date() },
                },
            }),
            // Visits completed this month
            prisma_1.default.visit.count({
                where: { companyId, status: 'completed', scheduledAt: { gte: monthStart } },
            }),
            // Deals closed (this month)
            prisma_1.default.lead.count({
                where: { companyId, status: 'closed_won', updatedAt: { gte: monthStart } },
            }),
            // AI conversations today
            prisma_1.default.conversation.count({
                where: { companyId, updatedAt: { gte: today } },
            }),
            // Revenue: sum of budget_max from closed_won leads
            prisma_1.default.lead.aggregate({
                where: { companyId, status: 'closed_won', updatedAt: { gte: monthStart } },
                _sum: { budgetMax: true },
            }),
        ]);
        // Conversion rate
        const totalLeadsForConversion = leadsTotal || 1;
        const conversionRate = totalLeadsForConversion > 0
            ? Math.round((dealsClosed / totalLeadsForConversion) * 100)
            : 0;
        const revenue = Number(revenueResult._sum.budgetMax) || 0;
        const dashData = {
            leads_today: leadsToday,
            leads_total: leadsTotal,
            visits_scheduled: visitsScheduled,
            visits_completed: visitsCompleted,
            deals_closed: dealsClosed,
            conversion_rate: conversionRate,
            ai_conversations: aiConversations,
            revenue,
        };
        // Cache for 60 seconds
        await (0, redis_1.cacheSet)(cacheKey, dashData, 60);
        res.json({ data: dashData, cached: false, cacheType: (0, redis_1.getCacheType)() });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch dashboard analytics', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});
/**
 * GET /api/analytics/leads
 * Get lead analytics over time.
 */
router.get('/leads', (0, rbac_1.authorize)('analytics', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const days = Math.min(parseInt(req.query.days) || 30, 365);
        // Cache for 300s — 3 DB queries called on every dashboard poll
        const cacheKey = `analytics:leads:${companyId}:${days}`;
        const cached = await (0, redis_1.cacheGet)(cacheKey);
        if (cached) {
            res.json({ data: cached, cached: true });
            return;
        }
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Leads by status
        const byStatusRaw = await prisma_1.default.lead.groupBy({
            by: ['status'],
            where: { companyId },
            _count: { id: true },
        });
        const by_status = byStatusRaw.map((s) => ({ status: s.status, count: s._count.id }));
        // Leads by source
        const bySourceRaw = await prisma_1.default.lead.groupBy({
            by: ['source'],
            where: { companyId },
            _count: { id: true },
        });
        const by_source = bySourceRaw.map((s) => ({ source: s.source, count: s._count.id }));
        // Daily lead counts (requires raw SQL for DATE grouping)
        const dailyLeads = await prisma_1.default.$queryRaw `
        SELECT DATE(created_at) as date, COUNT(id)::int as count
        FROM leads
        WHERE company_id = ${companyId}::uuid
        AND created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `;
        const data = { by_status, by_source, daily: dailyLeads };
        await (0, redis_1.cacheSet)(cacheKey, data, 300);
        res.json({ data, cached: false });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch lead analytics', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});
/**
 * GET /api/analytics/agents
 * Get agent performance analytics — uses groupBy to avoid N+1 fan-out.
 * Previous: 41 queries for 10 agents. Now: 5 queries regardless of agent count.
 */
router.get('/agents', (0, rbac_1.authorize)('analytics', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        if (req.user.role === 'sales_agent') {
            const ownStats = await getAgentStatsSingle(companyId, req.user.id);
            res.json({ data: [ownStats] });
            return;
        }
        const agents = await prisma_1.default.user.findMany({
            where: { companyId, role: 'sales_agent', status: 'active' },
            select: { id: true, name: true, email: true },
        });
        if (agents.length === 0) {
            res.json({ data: [] });
            return;
        }
        const agentIds = agents.map((a) => a.id);
        // Fetch all metrics in 4 groupBy queries instead of 4 × N per-agent queries
        const [activeGrouped, wonGrouped, lostGrouped, visitsGrouped] = await Promise.all([
            prisma_1.default.lead.groupBy({
                by: ['assignedAgentId'],
                where: { companyId, assignedAgentId: { in: agentIds }, status: { notIn: ['closed_won', 'closed_lost'] } },
                _count: { id: true },
            }),
            prisma_1.default.lead.groupBy({
                by: ['assignedAgentId'],
                where: { companyId, assignedAgentId: { in: agentIds }, status: 'closed_won' },
                _count: { id: true },
            }),
            prisma_1.default.lead.groupBy({
                by: ['assignedAgentId'],
                where: { companyId, assignedAgentId: { in: agentIds }, status: 'closed_lost' },
                _count: { id: true },
            }),
            prisma_1.default.visit.groupBy({
                by: ['agentId'],
                where: { companyId, agentId: { in: agentIds }, status: 'completed' },
                _count: { id: true },
            }),
        ]);
        const toMap = (rows, key) => new Map(rows.map((r) => [r[key], r._count.id]));
        const activeMap = toMap(activeGrouped, 'assignedAgentId');
        const wonMap = toMap(wonGrouped, 'assignedAgentId');
        const lostMap = toMap(lostGrouped, 'assignedAgentId');
        const visitsMap = toMap(visitsGrouped, 'agentId');
        const agentStats = agents.map((agent) => ({
            agent_id: agent.id,
            agent_name: agent.name,
            active_leads: activeMap.get(agent.id) || 0,
            closed_won: wonMap.get(agent.id) || 0,
            closed_lost: lostMap.get(agent.id) || 0,
            visits_completed: visitsMap.get(agent.id) || 0,
        }));
        res.json({ data: agentStats });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch agent analytics', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});
/**
 * Fetch stats for a single agent. Used when a sales_agent requests their own stats.
 */
async function getAgentStatsSingle(companyId, agentId) {
    const [activeLeads, closedWon, closedLost, visitsCompleted] = await Promise.all([
        prisma_1.default.lead.count({ where: { companyId, assignedAgentId: agentId, status: { notIn: ['closed_won', 'closed_lost'] } } }),
        prisma_1.default.lead.count({ where: { companyId, assignedAgentId: agentId, status: 'closed_won' } }),
        prisma_1.default.lead.count({ where: { companyId, assignedAgentId: agentId, status: 'closed_lost' } }),
        prisma_1.default.visit.count({ where: { companyId, agentId, status: 'completed' } }),
    ]);
    return { agent_id: agentId, agent_name: 'You', active_leads: activeLeads, closed_won: closedWon, closed_lost: closedLost, visits_completed: visitsCompleted };
}
/**
 * GET /api/analytics/recent-leads
 * Get the 10 most recent leads for dashboard.
 */
router.get('/recent-leads', (0, rbac_1.authorize)('analytics', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const where = { companyId };
        if (req.user.role === 'sales_agent') {
            where.assignedAgentId = req.user.id;
        }
        const leads = await prisma_1.default.lead.findMany({
            where,
            select: {
                id: true, customerName: true, phone: true, status: true,
                source: true, createdAt: true, propertyType: true,
                assignedAgent: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });
        const data = leads.map(({ assignedAgent, ...l }) => ({
            ...l,
            agent_name: assignedAgent?.name || null,
        }));
        res.json({ data });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch recent leads', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch recent leads' });
    }
});
/**
 * GET /api/analytics/upcoming-visits
 * Get the 10 upcoming visits for dashboard.
 */
router.get('/upcoming-visits', (0, rbac_1.authorize)('analytics', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const where = {
            companyId,
            status: { in: ['scheduled', 'confirmed'] },
            scheduledAt: { gte: new Date() },
        };
        if (req.user.role === 'sales_agent') {
            where.agentId = req.user.id;
        }
        const visits = await prisma_1.default.visit.findMany({
            where,
            select: {
                id: true, scheduledAt: true, status: true, durationMinutes: true,
                lead: { select: { customerName: true, phone: true } },
                property: { select: { name: true, locationArea: true } },
                agent: { select: { name: true } },
            },
            orderBy: { scheduledAt: 'asc' },
            take: 10,
        });
        const data = visits.map(({ lead, property, agent, scheduledAt, durationMinutes, ...v }) => ({
            id: v.id,
            status: v.status,
            scheduled_at: scheduledAt.toISOString(),
            duration_minutes: durationMinutes,
            customer_name: lead?.customerName || null,
            customer_phone: lead?.phone || null,
            property_name: property?.name || null,
            location_area: property?.locationArea || null,
            agent_name: agent?.name || null,
        }));
        res.json({ data });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch upcoming visits', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch upcoming visits' });
    }
});
/**
 * GET /api/analytics/trends
 * Compute real trend percentages by comparing current vs previous period.
 */
router.get('/trends', (0, rbac_1.authorize)('analytics', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const period = req.query.period || 'week';
        // Cache for 120s — 8 queries per call, polled frequently by dashboard
        const cacheKey = `analytics:trends:${companyId}:${period}`;
        const cached = await (0, redis_1.cacheGet)(cacheKey);
        if (cached) {
            res.json({ data: cached, period, cached: true });
            return;
        }
        let currentDays = 7;
        if (period === 'today')
            currentDays = 1;
        else if (period === 'month')
            currentDays = 30;
        const now = new Date();
        const currentStart = new Date(now.getTime() - currentDays * 24 * 60 * 60 * 1000);
        const prevStart = new Date(currentStart.getTime() - currentDays * 24 * 60 * 60 * 1000);
        const [currentLeads, prevLeads, currentVisits, prevVisits, currentDeals, prevDeals, currentConvos, prevConvos] = await Promise.all([
            prisma_1.default.lead.count({ where: { companyId, createdAt: { gte: currentStart } } }),
            prisma_1.default.lead.count({ where: { companyId, createdAt: { gte: prevStart, lt: currentStart } } }),
            prisma_1.default.visit.count({ where: { companyId, status: { in: ['scheduled', 'confirmed'] }, createdAt: { gte: currentStart } } }),
            prisma_1.default.visit.count({ where: { companyId, status: { in: ['scheduled', 'confirmed'] }, createdAt: { gte: prevStart, lt: currentStart } } }),
            prisma_1.default.lead.count({ where: { companyId, status: 'closed_won', updatedAt: { gte: currentStart } } }),
            prisma_1.default.lead.count({ where: { companyId, status: 'closed_won', updatedAt: { gte: prevStart, lt: currentStart } } }),
            prisma_1.default.conversation.count({ where: { companyId, updatedAt: { gte: currentStart } } }),
            prisma_1.default.conversation.count({ where: { companyId, updatedAt: { gte: prevStart, lt: currentStart } } }),
        ]);
        const calcTrend = (curr, prev) => {
            if (prev === 0)
                return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 100);
        };
        const data = {
            leads: calcTrend(currentLeads, prevLeads),
            visits: calcTrend(currentVisits, prevVisits),
            deals: calcTrend(currentDeals, prevDeals),
            conversations: calcTrend(currentConvos, prevConvos),
        };
        await (0, redis_1.cacheSet)(cacheKey, data, 120);
        res.json({ data, period, cached: false });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch trends', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch trends' });
    }
});
/**
 * GET /api/analytics/extended
 * Response time, escalation rate, peak hours, lost reasons, source ROI proxy.
 * Uses raw SQL aggregations instead of loading thousands of rows into Node.js memory.
 */
router.get('/extended', (0, rbac_1.authorize)('analytics', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const days = Math.min(parseInt(req.query.days) || 30, 180);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        // Cache for 600s — heavy computation, not time-critical
        const cacheKey = `analytics:extended:${companyId}:${days}`;
        const cached = await (0, redis_1.cacheGet)(cacheKey);
        if (cached) {
            res.json({ data: cached, cached: true });
            return;
        }
        const [escalated, totalConvos] = await Promise.all([
            prisma_1.default.conversation.count({ where: { companyId, escalatedAt: { not: null, gte: since } } }),
            prisma_1.default.conversation.count({ where: { companyId, createdAt: { gte: since } } }),
        ]);
        // Avg response time: SQL pairs consecutive customer→ai messages per conversation.
        // Eliminates loading 5000 rows into memory.
        const avgResponseResult = await prisma_1.default.$queryRaw `
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (ai.created_at - cust.created_at)) * 1000))::int AS avg_ms
        FROM messages cust
        JOIN LATERAL (
          SELECT created_at FROM messages
          WHERE conversation_id = cust.conversation_id
            AND sender_type = 'ai'
            AND created_at > cust.created_at
          ORDER BY created_at ASC
          LIMIT 1
        ) ai ON true
        JOIN conversations c ON c.id = cust.conversation_id
        WHERE c.company_id = ${companyId}::uuid
          AND cust.sender_type = 'customer'
          AND cust.created_at >= ${since}
          AND EXTRACT(EPOCH FROM (ai.created_at - cust.created_at)) BETWEEN 0 AND 300
      `;
        const avgResponseMs = avgResponseResult[0]?.avg_ms ?? null;
        // Peak hours: SQL GROUP BY HOUR — eliminates loading 8000 rows into memory.
        const peakHoursResult = await prisma_1.default.$queryRaw `
        SELECT EXTRACT(HOUR FROM m.created_at)::int AS hour, COUNT(m.id)::int AS count
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.company_id = ${companyId}::uuid
          AND m.sender_type = 'customer'
          AND m.created_at >= ${since}
        GROUP BY hour
        ORDER BY count DESC
      `;
        const lostReasons = {};
        try {
            const lostLeads = await prisma_1.default.lead.findMany({
                where: { companyId, status: 'closed_lost', updatedAt: { gte: since } },
                select: { metadata: true },
                take: 200,
            });
            for (const l of lostLeads) {
                const meta = l.metadata || {};
                const reason = meta.lost_reason || 'unspecified';
                lostReasons[reason] = (lostReasons[reason] || 0) + 1;
            }
        }
        catch {
            // metadata column may not exist on all DB versions
        }
        const [sourcesRaw, wonBySource] = await Promise.all([
            prisma_1.default.lead.groupBy({ by: ['source'], where: { companyId, createdAt: { gte: since } }, _count: { id: true } }),
            prisma_1.default.lead.groupBy({ by: ['source'], where: { companyId, status: 'closed_won', updatedAt: { gte: since } }, _count: { id: true } }),
        ]);
        const wonMap = new Map(wonBySource.map((s) => [s.source, s._count.id]));
        const source_roi = sourcesRaw.map((s) => ({
            source: s.source,
            leads: s._count.id,
            won: wonMap.get(s.source) || 0,
            conversion_pct: s._count.id > 0 ? Math.round(((wonMap.get(s.source) || 0) / s._count.id) * 100) : 0,
        }));
        const data = {
            avg_response_ms: avgResponseMs,
            escalation_rate_pct: totalConvos > 0 ? Math.round((escalated / totalConvos) * 100) : 0,
            escalated_count: escalated,
            peak_hours: peakHoursResult,
            lost_reasons: lostReasons,
            source_roi,
        };
        await (0, redis_1.cacheSet)(cacheKey, data, 600);
        res.json({ data, cached: false });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch extended analytics', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch extended analytics' });
    }
});
exports.default = router;
