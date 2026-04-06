import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { requireFeature } from '../middleware/featureGate';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { cacheGet, cacheSet, getCacheType } from '../config/redis';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('analytics'));

/**
 * GET /api/analytics/dashboard
 * Get dashboard statistics for the company.
 */
router.get(
  '/dashboard',
  authorize('analytics', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const cacheKey = `dashboard:${companyId}`;

      // Check Redis cache first (60s TTL)
      const cached = await cacheGet<any>(cacheKey);
      if (cached) {
        logger.info('Dashboard served from Redis cache', { companyId });
        res.json({ data: cached, cached: true, cacheType: getCacheType() });
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const [leadsToday, leadsTotal, visitsScheduled, visitsCompleted, dealsClosed, aiConversations, revenueResult] = await Promise.all([
        // Leads today
        prisma.lead.count({
          where: { companyId, createdAt: { gte: today } },
        }),
        // Total leads
        prisma.lead.count({
          where: { companyId },
        }),
        // Visits scheduled (upcoming)
        prisma.visit.count({
          where: {
            companyId,
            status: { in: ['scheduled', 'confirmed'] },
            scheduledAt: { gte: new Date() },
          },
        }),
        // Visits completed this month
        prisma.visit.count({
          where: { companyId, status: 'completed', scheduledAt: { gte: monthStart } },
        }),
        // Deals closed (this month)
        prisma.lead.count({
          where: { companyId, status: 'closed_won', updatedAt: { gte: monthStart } },
        }),
        // AI conversations today
        prisma.conversation.count({
          where: { companyId, updatedAt: { gte: today } },
        }),
        // Revenue: sum of budget_max from closed_won leads
        prisma.lead.aggregate({
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
      await cacheSet(cacheKey, dashData, 60);

      res.json({ data: dashData, cached: false, cacheType: getCacheType() });
    } catch (err: any) {
      logger.error('Failed to fetch dashboard analytics', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }
);

/**
 * GET /api/analytics/leads
 * Get lead analytics over time.
 */
router.get(
  '/leads',
  authorize('analytics', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const days = parseInt(req.query.days as string) || 30;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      // Leads by status
      const byStatusRaw = await prisma.lead.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { id: true },
      });
      const by_status = byStatusRaw.map((s) => ({ status: s.status, count: s._count.id }));

      // Leads by source
      const bySourceRaw = await prisma.lead.groupBy({
        by: ['source'],
        where: { companyId },
        _count: { id: true },
      });
      const by_source = bySourceRaw.map((s) => ({ source: s.source, count: s._count.id }));

      // Daily lead counts (requires raw SQL for DATE grouping)
      const dailyLeads = await prisma.$queryRaw<any[]>`
        SELECT DATE(created_at) as date, COUNT(id)::int as count
        FROM leads
        WHERE company_id = ${companyId}::uuid
        AND created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `;

      res.json({
        data: {
          by_status,
          by_source,
          daily: dailyLeads,
        },
      });
    } catch (err: any) {
      logger.error('Failed to fetch lead analytics', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }
);

/**
 * GET /api/analytics/agents
 * Get agent performance analytics.
 */
router.get(
  '/agents',
  authorize('analytics', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);

      // For sales agents only
      if (req.user!.role === 'sales_agent') {
        // Return only own stats
        const ownStats = await getAgentStats(companyId, req.user!.id);
        res.json({ data: [ownStats] });
        return;
      }

      // Get all agents
      const agents = await prisma.user.findMany({
        where: { companyId, role: 'sales_agent', status: 'active' },
        select: { id: true, name: true, email: true },
      });

      const agentStats = await Promise.all(
        agents.map((agent) => getAgentStats(companyId, agent.id, agent.name))
      );

      res.json({ data: agentStats });
    } catch (err: any) {
      logger.error('Failed to fetch agent analytics', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }
);

async function getAgentStats(companyId: string, agentId: string, agentName?: string) {
  const [activeLeads, closedWon, closedLost, visitsCompleted] = await Promise.all([
    prisma.lead.count({
      where: { companyId, assignedAgentId: agentId, status: { notIn: ['closed_won', 'closed_lost'] } },
    }),
    prisma.lead.count({
      where: { companyId, assignedAgentId: agentId, status: 'closed_won' },
    }),
    prisma.lead.count({
      where: { companyId, assignedAgentId: agentId, status: 'closed_lost' },
    }),
    prisma.visit.count({
      where: { companyId, agentId, status: 'completed' },
    }),
  ]);

  return {
    agent_id: agentId,
    agent_name: agentName || 'You',
    active_leads: activeLeads,
    closed_won: closedWon,
    closed_lost: closedLost,
    visits_completed: visitsCompleted,
  };
}

/**
 * GET /api/analytics/recent-leads
 * Get the 10 most recent leads for dashboard.
 */
router.get(
  '/recent-leads',
  authorize('analytics', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const where: any = { companyId };

      if (req.user!.role === 'sales_agent') {
        where.assignedAgentId = req.user!.id;
      }

      const leads = await prisma.lead.findMany({
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
    } catch (err: any) {
      logger.error('Failed to fetch recent leads', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch recent leads' });
    }
  }
);

/**
 * GET /api/analytics/upcoming-visits
 * Get the 10 upcoming visits for dashboard.
 */
router.get(
  '/upcoming-visits',
  authorize('analytics', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const where: any = {
        companyId,
        status: { in: ['scheduled', 'confirmed'] },
        scheduledAt: { gte: new Date() },
      };

      if (req.user!.role === 'sales_agent') {
        where.agentId = req.user!.id;
      }

      const visits = await prisma.visit.findMany({
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

      const data = visits.map(({ lead, property, agent, ...v }) => ({
        ...v,
        customer_name: lead?.customerName || null,
        customer_phone: lead?.phone || null,
        property_name: property?.name || null,
        location_area: property?.locationArea || null,
        agent_name: agent?.name || null,
      }));

      res.json({ data });
    } catch (err: any) {
      logger.error('Failed to fetch upcoming visits', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch upcoming visits' });
    }
  }
);

/**
 * GET /api/analytics/trends
 * Compute real trend percentages by comparing current vs previous period.
 */
router.get(
  '/trends',
  authorize('analytics', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const period = (req.query.period as string) || 'week';

      let currentDays = 7;
      if (period === 'today') currentDays = 1;
      else if (period === 'month') currentDays = 30;

      const now = new Date();
      const currentStart = new Date(now.getTime() - currentDays * 24 * 60 * 60 * 1000);
      const prevStart = new Date(currentStart.getTime() - currentDays * 24 * 60 * 60 * 1000);

      const [currentLeads, prevLeads, currentVisits, prevVisits, currentDeals, prevDeals, currentConvos, prevConvos] = await Promise.all([
        prisma.lead.count({ where: { companyId, createdAt: { gte: currentStart } } }),
        prisma.lead.count({ where: { companyId, createdAt: { gte: prevStart, lt: currentStart } } }),
        prisma.visit.count({ where: { companyId, status: { in: ['scheduled', 'confirmed'] }, createdAt: { gte: currentStart } } }),
        prisma.visit.count({ where: { companyId, status: { in: ['scheduled', 'confirmed'] }, createdAt: { gte: prevStart, lt: currentStart } } }),
        prisma.lead.count({ where: { companyId, status: 'closed_won', updatedAt: { gte: currentStart } } }),
        prisma.lead.count({ where: { companyId, status: 'closed_won', updatedAt: { gte: prevStart, lt: currentStart } } }),
        prisma.conversation.count({ where: { companyId, updatedAt: { gte: currentStart } } }),
        prisma.conversation.count({ where: { companyId, updatedAt: { gte: prevStart, lt: currentStart } } }),
      ]);

      const calcTrend = (curr: number, prev: number) => {
        if (prev === 0) return curr > 0 ? 100 : 0;
        return Math.round(((curr - prev) / prev) * 100);
      };

      res.json({
        data: {
          leads: calcTrend(currentLeads, prevLeads),
          visits: calcTrend(currentVisits, prevVisits),
          deals: calcTrend(currentDeals, prevDeals),
          conversations: calcTrend(currentConvos, prevConvos),
        },
        period,
      });
    } catch (err: any) {
      logger.error('Failed to fetch trends', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch trends' });
    }
  }
);

export default router;
