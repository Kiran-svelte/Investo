import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { exportRateLimiter } from '../middleware/rateLimiter';
import { createLeadSchema, updateLeadStatusSchema, isValidTransition, LEAD_TRANSITIONS, LeadStatus } from '../models/validation';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { notificationEngine } from '../services/notification.engine';
import { socketService, SOCKET_EVENTS } from '../services/socket.service';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('lead_automation'));

/**
 * GET /api/leads
 * List leads. Sales agents see only assigned leads.
 */
router.get(
  '/',
  authorize('leads', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const where: any = { companyId };

      // Sales agent: only assigned leads
      if (req.user!.role === 'sales_agent') {
        where.assignedAgentId = req.user!.id;
      }

      // Filters
      const { status, assigned_agent_id, property_type, search, sort_by, sort_order } = req.query;
      if (status) where.status = status as string;
      if (assigned_agent_id) where.assignedAgentId = assigned_agent_id as string;
      if (property_type) where.propertyType = property_type as string;
      if (search) {
        where.OR = [
          { customerName: { contains: search as string, mode: 'insensitive' as const } },
          { phone: { contains: search as string, mode: 'insensitive' as const } },
          { email: { contains: search as string, mode: 'insensitive' as const } },
        ];
      }

      // Sorting
      const sortFieldMap: Record<string, string> = {
        created_at: 'createdAt',
        updated_at: 'updatedAt',
        customer_name: 'customerName',
        status: 'status',
        budget_min: 'budgetMin',
        budget_max: 'budgetMax',
      };
      const sortField = sortFieldMap[(sort_by as string) || 'created_at'] || 'createdAt';
      const sortDir = (sort_order as string) === 'asc' ? 'asc' : 'desc';

      // Pagination
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
      const offset = (page - 1) * limit;

      const [leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          include: { assignedAgent: { select: { name: true } } },
          orderBy: { [sortField]: sortDir },
          skip: offset,
          take: limit,
        }),
        prisma.lead.count({ where }),
      ]);

      const data = leads.map(({ assignedAgent, ...l }) => ({
        ...l,
        agent_name: assignedAgent?.name || null,
      }));

      res.json({
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      logger.error('Failed to fetch leads', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch leads' });
    }
  }
);

/**
 * GET /api/leads/:id
 */
router.get(
  '/:id',
  authorize('leads', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const where: any = { id, companyId };

      // Sales agent: only if assigned
      if (req.user!.role === 'sales_agent') {
        where.assignedAgentId = req.user!.id;
      }

      const lead = await prisma.lead.findFirst({
        where,
        include: { assignedAgent: { select: { name: true } } },
      });

      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }

      // Get lead timeline (audit logs for this lead)
      const timeline = await prisma.auditLog.findMany({
        where: { companyId, resourceType: 'leads', resourceId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const { assignedAgent, ...leadData } = lead;
      res.json({ data: { ...leadData, agent_name: assignedAgent?.name || null, timeline } });
    } catch (err: any) {
      logger.error('Failed to fetch lead', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch lead' });
    }
  }
);

/**
 * POST /api/leads
 * Create a new lead. Always starts with status 'new'.
 */
router.post(
  '/',
  authorize('leads', 'create'),
  validate(createLeadSchema),
  auditLog('create', 'leads'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);

      // After Zod validation, req.body uses snake_case field names
      let agentId = req.body.assigned_agent_id;
      if (!agentId) {
        agentId = await assignLeadRoundRobin(companyId);
      }

      const lead = await prisma.lead.create({
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
        await notificationEngine.onLeadAssigned(lead, lead.assignedAgentId);
      }

      // Emit WebSocket event for real-time update
      socketService.emitToCompany(companyId, SOCKET_EVENTS.LEAD_CREATED, {
        lead: { ...lead, companyId: undefined }, // Don't expose companyId to frontend
      });

      res.status(201).json({ data: lead, id: lead.id });
    } catch (err: any) {
      logger.error('Failed to create lead', { error: err.message });
      res.status(500).json({ error: 'Failed to create lead' });
    }
  }
);

/**
 * PUT /api/leads/:id
 * Update lead fields (not status - use PATCH for that).
 */
router.put(
  '/:id',
  authorize('leads', 'update'),
  auditLog('update', 'leads'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const lead = await prisma.lead.findFirst({ where: { id, companyId } });
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }

      // Sales agent can only update assigned leads
      if (req.user!.role === 'sales_agent' && lead.assignedAgentId !== req.user!.id) {
        res.status(403).json({ error: 'Can only update assigned leads' });
        return;
      }

      const { customer_name, email, budget_min, budget_max, location_preference, property_type, assigned_agent_id, notes, language } = req.body;

      const oldAgentId = lead.assignedAgentId;

      const updated = await prisma.lead.update({
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
          await notificationEngine.onLeadReassigned(updated, oldAgentId, assigned_agent_id);
          
          // Emit socket event for lead assignment
          socketService.emitToUser(assigned_agent_id, SOCKET_EVENTS.LEAD_ASSIGNED, {
            lead: { ...updated, companyId: undefined },
          });
        }
      }

      // Emit WebSocket event for lead update
      socketService.emitToCompany(companyId, SOCKET_EVENTS.LEAD_UPDATED, {
        lead: { ...updated, companyId: undefined },
      });

      res.json({ data: updated });
    } catch (err: any) {
      logger.error('Failed to update lead', { error: err.message });
      res.status(500).json({ error: 'Failed to update lead' });
    }
  }
);

/**
 * PATCH /api/leads/:id/status
 * Transition lead status. Enforces state machine.
 * Leads CANNOT be deleted - only closed.
 */
router.patch(
  '/:id/status',
  authorize('leads', 'update'),
  validate(updateLeadStatusSchema),
  auditLog('status_change', 'leads'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { status: newStatus } = req.body;

      const lead = await prisma.lead.findFirst({ where: { id, companyId } });
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }

      // Sales agent can only update assigned leads
      if (req.user!.role === 'sales_agent' && lead.assignedAgentId !== req.user!.id) {
        res.status(403).json({ error: 'Can only update assigned leads' });
        return;
      }

      const currentStatus = lead.status as LeadStatus;
      const targetStatus = newStatus as LeadStatus;

      // Special case: only company_admin can reopen closed_lost -> contacted
      if (currentStatus === 'closed_lost' && targetStatus === 'contacted') {
        if (req.user!.role !== 'company_admin' && req.user!.role !== 'super_admin') {
          res.status(403).json({ error: 'Only company admin can reopen closed leads' });
          return;
        }
        // Allow this transition
      } else if (!isValidTransition(LEAD_TRANSITIONS, currentStatus, targetStatus)) {
        res.status(400).json({
          error: `Invalid status transition: ${currentStatus} -> ${targetStatus}`,
          allowed: LEAD_TRANSITIONS[currentStatus],
        });
        return;
      }

      const updated = await prisma.lead.update({
        where: { id },
        data: {
          status: targetStatus,
          lastContactAt: new Date(),
        },
      });

      await notificationEngine.onLeadStatusChange(lead, currentStatus, targetStatus);

      res.json({ data: updated });
    } catch (err: any) {
      logger.error('Failed to update lead status', { error: err.message });
      res.status(500).json({ error: 'Failed to update lead status' });
    }
  }
);

/**
 * POST /api/leads/import/csv
 * Bulk import leads from CSV. Company admin only.
 * Expected CSV format: name,phone,email,budget_min,budget_max,location,property_type,source
 */
router.post(
  '/import/csv',
  authorize('leads', 'create'),
  auditLog('bulk_import', 'leads'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);

      if (req.user!.role !== 'company_admin' && req.user!.role !== 'super_admin') {
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
        errors: [] as { row: number; error: string }[],
        leads: [] as any[],
      };

      const validPropertyTypes = ['apartment', 'villa', 'plot', 'commercial', 'penthouse'];
      const validSources = ['whatsapp', 'website', 'referral', 'facebook', 'google', 'walk_in', 'other'];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          // Handle CSV with quotes
          const values = parseCSVLine(line);
          const row: Record<string, string> = {};
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
          const existing = await prisma.lead.findFirst({
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

          const leadData: any = {
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

          const lead = await prisma.lead.create({ data: leadData });
          results.success++;
          results.leads.push(lead);

          // Emit socket event
          socketService.emitToCompany(companyId, SOCKET_EVENTS.LEAD_CREATED, {
            lead: { ...lead, companyId: undefined },
          });

          // Notify assigned agent
          if (assignedAgentId) {
            await notificationEngine.onLeadAssigned(lead, assignedAgentId);
            socketService.emitToUser(assignedAgentId, SOCKET_EVENTS.LEAD_ASSIGNED, {
              lead: { ...lead, companyId: undefined },
            });
          }
        } catch (err: any) {
          results.failed++;
          results.errors.push({ row: i + 1, error: err.message });
        }
      }

      logger.info('Bulk lead import completed', {
        companyId,
        userId: req.user!.id,
        success: results.success,
        failed: results.failed,
      });

      res.json({
        message: `Imported ${results.success} leads, ${results.failed} failed`,
        success: results.success,
        failed: results.failed,
        errors: results.errors.slice(0, 50), // Limit error output
      });
    } catch (err: any) {
      logger.error('Failed to import leads', { error: err.message });
      res.status(500).json({ error: 'Failed to import leads' });
    }
  }
);

/**
 * Parse CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
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
router.get(
  '/import/template',
  authorize('leads', 'create'),
  async (_req: AuthRequest, res: Response) => {
    const template = 'name,phone,email,budget_min,budget_max,location,property_type,source\n' +
      'John Doe,+919876543210,john@email.com,5000000,10000000,Mumbai,apartment,website\n' +
      'Jane Smith,9123456789,jane@email.com,3000000,7000000,Pune,villa,referral';

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=lead_import_template.csv');
    res.send(template);
  }
);

/**
 * GET /api/leads/export/csv
 * Export leads as CSV. Company admin only.
 * Rate limited: 10 exports per hour per user
 */
router.get(
  '/export/csv',
  authorize('leads', 'read'),
  exportRateLimiter,
  auditLog('export', 'leads'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);

      if (req.user!.role !== 'company_admin' && req.user!.role !== 'super_admin') {
        res.status(403).json({ error: 'Only admins can export data' });
        return;
      }

      const leads = await prisma.lead.findMany({
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
    } catch (err: any) {
      logger.error('Failed to export leads', { error: err.message });
      res.status(500).json({ error: 'Failed to export leads' });
    }
  }
);

/**
 * Round-robin agent assignment
 */
async function assignLeadRoundRobin(companyId: string): Promise<string | null> {
  // Get all active sales agents for this company
  const agents = await prisma.user.findMany({
    where: { companyId, role: 'sales_agent', status: 'active' },
    select: { id: true },
  });

  if (agents.length === 0) return null;

  // Count active leads per agent
  const leadCounts = await prisma.lead.groupBy({
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

export default router;
