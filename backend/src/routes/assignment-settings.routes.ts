import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { parseRoutingSettings, type LeadRoutingSettings } from '../services/leadRouting.service';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);

router.get(
  '/',
  authorize('leads', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const routing = parseRoutingSettings(company?.settings);
      const agents = await prisma.user.findMany({
        where: { companyId, role: 'sales_agent', status: 'active' },
        select: { id: true, name: true, email: true },
      });
      const settings = (company?.settings as Record<string, unknown>) || {};
      res.json({
        data: {
          routing,
          agents,
          export_webhook_url: typeof settings.export_webhook_url === 'string' ? settings.export_webhook_url : '',
          google_sheets_export: {
            enabled: false,
            message:
              'Google Sheets sync is not configured. Use CSV/JSON export from Leads, or set export_webhook_url in company settings for Zapier/Make.',
          },
        },
      });
    } catch (err: any) {
      logger.error('Failed to load assignment settings', { error: err.message });
      res.status(500).json({ error: 'Failed to load settings' });
    }
  },
);

router.put(
  '/',
  authorize('leads', 'update'),
  auditLog('update', 'assignment_settings'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const routing = req.body?.routing as LeadRoutingSettings | undefined;
      const exportWebhookUrl =
        typeof req.body?.export_webhook_url === 'string' ? req.body.export_webhook_url : undefined;

      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const settings = { ...((company?.settings as object) || {}) };
      if (routing) {
        (settings as Record<string, unknown>).lead_routing = routing;
      }
      if (exportWebhookUrl !== undefined) {
        (settings as Record<string, unknown>).export_webhook_url = exportWebhookUrl;
      }

      await prisma.company.update({
        where: { id: companyId },
        data: { settings: settings as object },
      });

      res.json({ data: { routing: parseRoutingSettings(settings), export_webhook_url: exportWebhookUrl ?? (settings as any).export_webhook_url } });
    } catch (err: any) {
      logger.error('Failed to save assignment settings', { error: err.message });
      res.status(500).json({ error: 'Failed to save settings' });
    }
  },
);

export default router;
