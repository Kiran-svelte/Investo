import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);

// All available features
const ALL_FEATURES = [
  { key: 'ai_bot', name: 'AI WhatsApp Bot', description: 'AI-powered WhatsApp conversations' },
  { key: 'analytics', name: 'Analytics Dashboard', description: 'Advanced analytics and reporting' },
  { key: 'visit_scheduling', name: 'Visit Scheduling', description: 'Site visit booking and calendar' },
  { key: 'notifications', name: 'Notifications', description: 'Real-time alerts and reminders' },
  { key: 'agent_management', name: 'Agent Management', description: 'Sales team management' },
  { key: 'conversation_center', name: 'Conversation Center', description: 'Chat monitoring and takeover' },
  { key: 'lead_automation', name: 'Lead Automation', description: 'Auto-assignment and follow-ups' },
  { key: 'property_management', name: 'Property Management', description: 'Property listings and search' },
  { key: 'audit_logs', name: 'Audit Logs', description: 'Activity tracking and compliance' },
  { key: 'csv_export', name: 'CSV Export', description: 'Data export capabilities' },
] as const;

/**
 * GET /api/features
 * List all features and their status for this company
 */
router.get(
  '/',
  authorize('ai_settings', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const dbFeatures = await prisma.companyFeature.findMany({
        where: { companyId },
      });

      const featureMap = new Map(dbFeatures.map(f => [f.featureKey, f]));

      // Merge with all available features
      const features = ALL_FEATURES.map(f => {
        const dbF = featureMap.get(f.key);
        return {
          key: f.key,
          name: f.name,
          description: f.description,
          enabled: dbF ? dbF.enabled : true, // default enabled
          config: dbF ? dbF.config : {},
          id: dbF?.id || null,
        };
      });

      res.json({ data: features });
    } catch (err: any) {
      logger.error('Failed to list features', { error: err.message });
      res.status(500).json({ error: 'Failed to list features' });
    }
  }
);

/**
 * PUT /api/features/:key
 * Toggle a feature on/off for this company
 */
router.put(
  '/:key',
  authorize('ai_settings', 'update'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { key } = req.params;
      const { enabled, config } = req.body;

      const validKeys = ALL_FEATURES.map(f => f.key);
      if (!validKeys.includes(key as any)) {
        res.status(400).json({ error: `Invalid feature key. Valid: ${validKeys.join(', ')}` });
        return;
      }

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }

      const feature = await prisma.companyFeature.upsert({
        where: { companyId_featureKey: { companyId, featureKey: key } },
        create: {
          companyId,
          featureKey: key,
          enabled,
          config: config || {},
        },
        update: {
          enabled,
          ...(config && { config }),
        },
      });

      res.json({ data: feature });
    } catch (err: any) {
      logger.error('Failed to update feature', { error: err.message });
      res.status(500).json({ error: 'Failed to update feature' });
    }
  }
);

/**
 * PUT /api/features (bulk update)
 * Update multiple features at once
 */
router.put(
  '/',
  authorize('ai_settings', 'update'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { features } = req.body;

      if (!Array.isArray(features)) {
        res.status(400).json({ error: 'features must be an array of { key, enabled }' });
        return;
      }

      const validKeys = ALL_FEATURES.map(f => f.key);
      const results = [];

      for (const f of features) {
        if (!validKeys.includes(f.key)) continue;
        const result = await prisma.companyFeature.upsert({
          where: { companyId_featureKey: { companyId, featureKey: f.key } },
          create: { companyId, featureKey: f.key, enabled: !!f.enabled, config: f.config || {} },
          update: { enabled: !!f.enabled, ...(f.config && { config: f.config }) },
        });
        results.push(result);
      }

      res.json({ data: results, updated: results.length });
    } catch (err: any) {
      logger.error('Failed to bulk update features', { error: err.message });
      res.status(500).json({ error: 'Failed to update features' });
    }
  }
);

export default router;
