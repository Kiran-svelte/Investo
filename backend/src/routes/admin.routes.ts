import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);
router.use(hasRole('super_admin'));

/**
 * GET /api/admin/dashboard
 * Super admin platform dashboard.
 */
router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [companiesTotal, companiesActive, usersTotal, agentsTotal, conversationsToday, messagesToday] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { status: 'active' } }),
      prisma.user.count(),
      prisma.user.count({ where: { role: 'sales_agent', status: 'active' } }),
      prisma.conversation.count({ where: { createdAt: { gte: today } } }),
      prisma.message.count({ where: { senderType: 'ai', createdAt: { gte: today } } }),
    ]);

    // Monthly revenue (sum of active companies' plan prices)
    const activeCompanies = await prisma.company.findMany({
      where: { status: 'active', planId: { not: null } },
      include: { plan: { select: { priceMonthly: true } } },
    });
    const monthlyRevenue = activeCompanies.reduce(
      (sum, c) => sum + (Number(c.plan?.priceMonthly) || 0), 0
    );

    res.json({
      data: {
        companies_total: companiesTotal,
        companies_active: companiesActive,
        users_total: usersTotal,
        agents_active: agentsTotal,
        conversations_today: conversationsToday,
        ai_messages_today: messagesToday,
        monthly_revenue: monthlyRevenue,
      },
    });
  } catch (err: any) {
    logger.error('Failed to fetch admin dashboard', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

/**
 * GET /api/admin/system
 * System monitoring endpoint.
 */
router.get('/system', async (req: AuthRequest, res: Response) => {
  try {
    // Database health
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - dbStart;

    // Queue status (placeholder - would integrate with Bull/Redis)
    const queueStatus = {
      pending: 0,
      processing: 0,
      failed: 0,
    };

    // Memory usage
    const memUsage = process.memoryUsage();

    // Recent errors (from audit logs)
    const recentErrors = await prisma.auditLog.findMany({
      where: { action: { contains: 'error' } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json({
      data: {
        status: 'healthy',
        db_latency_ms: dbLatency,
        queue: queueStatus,
        memory: {
          heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
          rss_mb: Math.round(memUsage.rss / 1024 / 1024),
        },
        uptime_seconds: Math.round(process.uptime()),
        recent_errors: recentErrors,
      },
    });
  } catch (err: any) {
    logger.error('System check failed', { error: err.message });
    res.status(500).json({
      data: {
        status: 'unhealthy',
        error: err.message,
      },
    });
  }
});

/**
 * GET /api/admin/companies
 * List all companies with detailed stats.
 */
router.get('/companies', async (req: AuthRequest, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: { plan: { select: { name: true, priceMonthly: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with stats
    const enriched = await Promise.all(
      companies.map(async ({ plan, ...company }) => {
        const [usersCount, leadsCount, conversationsCount] = await Promise.all([
          prisma.user.count({ where: { companyId: company.id, status: 'active' } }),
          prisma.lead.count({ where: { companyId: company.id } }),
          prisma.conversation.count({ where: { companyId: company.id } }),
        ]);

        return {
          ...company,
          plan_name: plan?.name ?? null,
          price_monthly: plan?.priceMonthly ?? null,
          users_count: usersCount,
          leads_count: leadsCount,
          conversations_count: conversationsCount,
        };
      })
    );

    res.json({ data: enriched, total: enriched.length });
  } catch (err: any) {
    logger.error('Failed to fetch companies', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

/**
 * GET /api/admin/usage
 * AI usage and WhatsApp message stats by company.
 */
router.get('/usage', async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // AI messages by company (requires raw SQL for cross-model grouping)
    const aiUsage = await prisma.$queryRaw<any[]>`
      SELECT c.company_id, COUNT(m.id)::int as ai_messages
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.sender_type = 'ai'
      AND m.created_at >= ${startDate}
      GROUP BY c.company_id
    `;

    // Get company names
    const companyIds = aiUsage.map((u: any) => u.company_id).filter(Boolean);
    const companies = companyIds.length > 0
      ? await prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, name: true },
        })
      : [];

    const companyMap = new Map(companies.map((c) => [c.id, c.name]));

    const usageData = aiUsage.map((u: any) => ({
      company_id: u.company_id,
      company_name: companyMap.get(u.company_id) || 'Unknown',
      ai_messages: u.ai_messages,
    }));

    res.json({ data: usageData, period_days: days });
  } catch (err: any) {
    logger.error('Failed to fetch usage stats', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

export default router;
