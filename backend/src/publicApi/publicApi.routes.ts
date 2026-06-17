import { Router, Response } from 'express';

import config from '../config';
import prisma from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { apiKeyService } from './apiKey.service';
import { webhookSubscriptionService } from './webhookSubscription.service';
import { publicApiKeyAuth, PublicApiRequest, requireScope } from './publicApiAuth.middleware';

function prismaClient(): any {
  return prisma as any;
}

const router = Router();

router.get('/health', (_req, res: Response) => {
  res.json({
    status: 'ok',
    version: 'v1',
    public_api_enabled: config.features.publicApi === true,
  });
});

router.get('/leads', publicApiKeyAuth, requireScope('leads:read'), async (req: PublicApiRequest, res: Response) => {
  const companyId = req.publicApi?.companyId;
  if (!companyId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const leads = await prismaClient().lead.findMany({
    where: { companyId },
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      customerName: true,
      phone: true,
      status: true,
      createdAt: true,
    },
  });

  res.json({ leads });
});

router.use(authenticate);
router.use(hasRole('company_admin', 'super_admin'));

router.get('/keys', async (req: AuthRequest, res: Response) => {
  if (!config.features.publicApi) {
    res.status(503).json({ error: 'FEATURE_PUBLIC_API is disabled' });
    return;
  }
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const keys = await apiKeyService.listKeys(companyId);
  res.json({ keys });
});

router.post('/keys', async (req: AuthRequest, res: Response) => {
  if (!config.features.publicApi) {
    res.status(503).json({ error: 'FEATURE_PUBLIC_API is disabled' });
    return;
  }
  const companyId = req.user?.company_id;
  const userId = req.user?.id;
  if (!companyId || !userId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const { name, scopes } = req.body || {};
  if (!name || !Array.isArray(scopes)) {
    res.status(400).json({ error: 'name and scopes[] are required' });
    return;
  }
  try {
    const created = await apiKeyService.createKey({
      companyId,
      name,
      scopes,
      createdBy: userId,
    });
    res.status(201).json({
      key: created.apiKey,
      raw_key: created.rawKey,
      warning: 'Store raw_key securely; it will not be shown again.',
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete('/keys/:id', async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const result = await apiKeyService.revokeKey(companyId, req.params.id);
  res.json({ revoked: result.count > 0 });
});

router.get('/webhooks', async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const subscriptions = await webhookSubscriptionService.listActive(companyId);
  res.json({
    subscriptions: subscriptions.map((s: any) => ({
      id: s.id,
      url: s.url,
      events: s.events,
      active: s.active,
      createdAt: s.createdAt,
    })),
  });
});

router.post('/webhooks', async (req: AuthRequest, res: Response) => {
  if (!config.features.publicApi) {
    res.status(503).json({ error: 'FEATURE_PUBLIC_API is disabled' });
    return;
  }
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const { url, events } = req.body || {};
  if (!url || !Array.isArray(events)) {
    res.status(400).json({ error: 'url and events[] are required' });
    return;
  }
  try {
    const created = await webhookSubscriptionService.createSubscription({
      companyId,
      url,
      events,
    });
    res.status(201).json({
      subscription: {
        id: created.subscription.id,
        url: created.subscription.url,
        events: created.subscription.events,
      },
      secret: created.secret,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/webhooks/test', async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  await webhookSubscriptionService.dispatch(companyId, 'test.ping', { ok: true }, req.body?.secret);
  res.json({ dispatched: true });
});

export default router;
