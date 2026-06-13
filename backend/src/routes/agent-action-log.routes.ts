/**
 * Agent Action Log API Routes
 *
 * Exposes the `agent_action_logs` table for dashboard inspection.
 * Company-scoped, paginated, and filterable. Admin-only.
 *
 * Endpoints:
 *   GET /api/agent-action-logs  — list with filters
 *   GET /api/agent-action-logs/:id — single entry
 *
 * Authorization:
 *   - `company_admin` can view their own company's logs.
 *   - `super_admin` can filter by any companyId.
 *
 * Design:
 *   - Follows the same guard pattern as `audit.routes.ts`.
 *   - All timestamps returned as UTC ISO strings.
 *   - `inputs` JSON never exposed as raw SQL — always Prisma-parameterised.
 */

import { Router, Response } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import prisma from '../config/prisma';
import logger from '../config/logger';

/** Maximum records per page — mirrors audit route cap. */
const MAX_PAGE_SIZE = 100;
/** Default page size. */
const DEFAULT_PAGE_SIZE = 50;

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);

/**
 * GET /api/agent-action-logs
 *
 * Returns a paginated list of agent action log entries for the caller's company.
 *
 * Query params:
 *   limit        — records per page (default 50, max 100)
 *   page         — 1-indexed page number (default 1)
 *   action       — substring filter on the action field (case-insensitive)
 *   status       — exact filter: 'success' | 'failed' | 'skipped'
 *   resourceType — exact filter on resourceType
 *   resourceId   — exact filter on resourceId (e.g. leadId, visitId)
 *   triggeredBy  — exact filter: 'cron' | 'agent_tool' | 'automation' | 'inbound_message'
 *   from         — ISO date string; only entries at or after this time
 *   to           — ISO date string; only entries before this time
 *   companyId    — super_admin only; filter by a specific tenant
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isAdmin = role === 'company_admin' || role === 'super_admin';
    if (!isAdmin) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'AI action logs are only accessible to company admins.',
          requestId: (req as any).requestId,
        },
      });
      return;
    }

    const pageRaw = parseInt((req.query.page as string) || '1', 10);
    const limitRaw = parseInt((req.query.limit as string) || String(DEFAULT_PAGE_SIZE), 10);
    const page = isNaN(pageRaw) || pageRaw < 1 ? 1 : pageRaw;
    const limit = Math.min(isNaN(limitRaw) || limitRaw < 1 ? DEFAULT_PAGE_SIZE : limitRaw, MAX_PAGE_SIZE);
    const skip = (page - 1) * limit;

    // Tenant scoping: super_admin may optionally filter by a specific companyId.
    let scopedCompanyId: string | undefined;
    if (role === 'super_admin') {
      scopedCompanyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
      if (!scopedCompanyId) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: 'companyId query parameter is required for platform AI action log access.',
            requestId: (req as any).requestId,
          },
        });
        return;
      }
    } else {
      scopedCompanyId = getCompanyId(req);
      if (!scopedCompanyId) {
        res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'Company context is required.', requestId: (req as any).requestId },
        });
        return;
      }
    }

    // Build Prisma where clause from query params.
    const where: Record<string, unknown> = {};
    if (scopedCompanyId) where.companyId = scopedCompanyId;

    const actionFilter = req.query.action as string | undefined;
    if (actionFilter?.trim()) {
      where.action = { contains: actionFilter.trim(), mode: 'insensitive' };
    }

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter && ['success', 'failed', 'skipped'].includes(statusFilter)) {
      where.status = statusFilter;
    }

    const resourceTypeFilter = req.query.resourceType as string | undefined;
    if (resourceTypeFilter?.trim()) {
      where.resourceType = resourceTypeFilter.trim();
    }

    const resourceIdFilter = req.query.resourceId as string | undefined;
    if (resourceIdFilter?.trim()) {
      where.resourceId = resourceIdFilter.trim();
    }

    const triggeredByFilter = req.query.triggeredBy as string | undefined;
    const validTriggers = new Set(['cron', 'agent_tool', 'automation', 'inbound_message']);
    if (triggeredByFilter && validTriggers.has(triggeredByFilter)) {
      where.triggeredBy = triggeredByFilter;
    }

    const fromFilter = req.query.from as string | undefined;
    const toFilter = req.query.to as string | undefined;
    if (fromFilter || toFilter) {
      const createdAt: Record<string, Date> = {};
      if (fromFilter) {
        const d = new Date(fromFilter);
        if (!isNaN(d.getTime())) createdAt.gte = d;
      }
      if (toFilter) {
        const d = new Date(toFilter);
        if (!isNaN(d.getTime())) createdAt.lt = d;
      }
      if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;
    }

    const [logs, total] = await Promise.all([
      prisma.agentActionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          companyId: true,
          triggeredBy: true,
          action: true,
          actorId: true,
          actorRole: true,
          resourceType: true,
          resourceId: true,
          inputs: true,
          result: true,
          status: true,
          errorMessage: true,
          durationMs: true,
          createdAt: true,
        },
      }),
      prisma.agentActionLog.count({ where }),
    ]);

    res.json({
      data: logs.map((log) => ({
        id: log.id,
        companyId: log.companyId,
        triggeredBy: log.triggeredBy,
        action: log.action,
        actorId: log.actorId,
        actorRole: log.actorRole,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        inputs: log.inputs,
        result: log.result,
        status: log.status,
        errorMessage: log.errorMessage,
        durationMs: log.durationMs,
        createdAt: log.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: unknown) {
    logger.error('Failed to fetch agent action logs', {
      error: err instanceof Error ? err.message : String(err),
      requestId: (req as any).requestId,
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch agent action logs.',
        requestId: (req as any).requestId,
      },
    });
  }
});

/**
 * GET /api/agent-action-logs/:id
 *
 * Returns a single agent action log entry by ID.
 * Company-scoped: non-super_admin callers cannot access entries from other companies.
 *
 * @returns 200 with full log entry including `inputs` JSON.
 * @returns 404 if not found or belongs to another company.
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isAdmin = role === 'company_admin' || role === 'super_admin';
    if (!isAdmin) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'AI action logs are only accessible to company admins.',
          requestId: (req as any).requestId,
        },
      });
      return;
    }

    const { id } = req.params;
    const where: Record<string, unknown> = { id };
    const companyId = role === 'super_admin'
      ? (typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '')
      : getCompanyId(req);
    if (!companyId) {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: role === 'super_admin'
            ? 'companyId query parameter is required for platform AI action log access.'
            : 'Company context is required.',
          requestId: (req as any).requestId,
        },
      });
      return;
    }
    where.companyId = companyId;

    const log = await prisma.agentActionLog.findFirst({ where });
    if (!log) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Agent action log entry not found.',
          requestId: (req as any).requestId,
        },
      });
      return;
    }

    res.json({
      data: {
        id: log.id,
        companyId: log.companyId,
        triggeredBy: log.triggeredBy,
        action: log.action,
        actorId: log.actorId,
        actorRole: log.actorRole,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        inputs: log.inputs,
        result: log.result,
        status: log.status,
        errorMessage: log.errorMessage,
        durationMs: log.durationMs,
        createdAt: log.createdAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    logger.error('Failed to fetch agent action log entry', {
      error: err instanceof Error ? err.message : String(err),
      requestId: (req as any).requestId,
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch agent action log entry.',
        requestId: (req as any).requestId,
      },
    });
  }
});

export default router;
