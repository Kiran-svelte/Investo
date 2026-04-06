import { Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from './auth';
import { getCompanyId } from './tenant';
import { cacheGet, cacheSet } from '../config/redis';

export type FeatureKey =
  | 'ai_bot'
  | 'analytics'
  | 'visit_scheduling'
  | 'notifications'
  | 'agent_management'
  | 'conversation_center'
  | 'lead_automation'
  | 'property_management'
  | 'audit_logs'
  | 'csv_export';

const TTL_SECONDS = 60;

async function isFeatureEnabled(companyId: string, featureKey: FeatureKey): Promise<boolean> {
  const cacheKey = `feature:${companyId}:${featureKey}`;
  const cached = await cacheGet<boolean>(cacheKey);
  if (typeof cached === 'boolean') {
    return cached;
  }

  const feature = await prisma.companyFeature.findUnique({
    where: {
      companyId_featureKey: {
        companyId,
        featureKey,
      },
    },
    select: { enabled: true },
  });

  // Default behavior: enabled unless explicitly disabled
  const enabled = feature ? feature.enabled : true;
  await cacheSet(cacheKey, enabled, TTL_SECONDS);
  return enabled;
}

export function requireFeature(featureKey: FeatureKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Super admin can always access.
    if (user.role === 'super_admin') {
      next();
      return;
    }

    const companyId = getCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: 'Company context missing' });
      return;
    }

    const enabled = await isFeatureEnabled(companyId, featureKey);
    if (!enabled) {
      res.status(403).json({
        error: 'Feature disabled',
        feature_key: featureKey,
      });
      return;
    }

    next();
  };
}
