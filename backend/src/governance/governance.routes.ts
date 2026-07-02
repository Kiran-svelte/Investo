import { Router, Response } from 'express';

import config from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { promptVersionService } from './promptVersion.service';
import { aiReviewQueueService } from './aiReviewQueue.service';
import { messageArchiveService } from './messageArchive.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin', 'super_admin'));

function resolveGovernanceCompanyId(req: AuthRequest, res: Response): string | null {
  if (req.user?.role === 'super_admin') {
    const targetCompanyId = typeof req.query.target_company_id === 'string'
      ? req.query.target_company_id.trim()
      : '';

    if (!targetCompanyId) {
      res.status(400).json({
        error: 'target_company_id query parameter is required for platform AI governance access',
      });
      return null;
    }

    return targetCompanyId;
  }

  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return null;
  }

  return companyId;
}

router.get('/prompts', async (req: AuthRequest, res: Response) => {
  const name = typeof req.query.name === 'string' ? req.query.name : undefined;
  const versions = await promptVersionService.listVersions(name);
  res.json({
    versions: versions.map((row: any) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      status: row.status,
      active: row.status === 'active',
      createdAt: row.createdAt,
    })),
    enabled: promptVersionService.isEnabled(),
  });
});

router.post('/prompts', async (req: AuthRequest, res: Response) => {
  if (!config.features.promptVersioning) {
    res.status(503).json({ error: 'FEATURE_PROMPT_VERSIONING is disabled' });
    return;
  }
  const { name, version, content, status } = req.body || {};
  if (!name || !version || !content) {
    res.status(400).json({ error: 'name, version, and content are required' });
    return;
  }
  const created = await promptVersionService.createVersion({ name, version, content, status });
  res.status(201).json({ version: created });
});

router.post('/prompts/:name/:version/activate', async (req: AuthRequest, res: Response) => {
  if (!config.features.promptVersioning) {
    res.status(503).json({ error: 'FEATURE_PROMPT_VERSIONING is disabled' });
    return;
  }
  const activated = await promptVersionService.activate(req.params.name, req.params.version);
  res.json({ version: activated });
});

router.get('/ai-review-queue', async (req: AuthRequest, res: Response) => {
  const companyId = resolveGovernanceCompanyId(req, res);
  if (!companyId) {
    return;
  }
  const items = await aiReviewQueueService.listPending(companyId);
  res.json({
    items: items.map((row: any) => ({
      id: row.id,
      messageId: row.messageId,
      riskScore: row.riskScore,
      reason: row.reason || null,
      status: row.status,
      createdAt: row.createdAt,
    })),
    enabled: aiReviewQueueService.isEnabled(),
    threshold: aiReviewQueueService.getRiskThreshold(),
  });
});

router.post('/ai-review-queue/:id/review', async (req: AuthRequest, res: Response) => {
  if (!config.features.aiReviewQueue) {
    res.status(503).json({ error: 'FEATURE_AI_REVIEW_QUEUE is disabled' });
    return;
  }
  const companyId = resolveGovernanceCompanyId(req, res);
  const userId = req.user?.id;
  if (!companyId) {
    return;
  }
  if (!userId) {
    res.status(400).json({ error: 'User context required' });
    return;
  }
  const status = req.body?.status;
  if (status !== 'approved' && status !== 'rejected') {
    res.status(400).json({ error: 'status must be approved or rejected' });
    return;
  }
  const result = await aiReviewQueueService.review(req.params.id, companyId, userId, status);
  res.json({ updated: result.count });
});

router.post('/message-archives', async (req: AuthRequest, res: Response) => {
  if (!config.features.messageArchive) {
    res.status(503).json({ error: 'FEATURE_MESSAGE_ARCHIVE is disabled' });
    return;
  }
  const companyId = resolveGovernanceCompanyId(req, res);
  if (!companyId) {
    return;
  }
  const { message_id, content } = req.body || {};
  if (!message_id || !content) {
    res.status(400).json({ error: 'message_id and content are required' });
    return;
  }
  const archive = await messageArchiveService.archiveMessage({
    companyId,
    messageId: message_id,
    content,
  });
  res.status(201).json({ archive });
});

router.get('/message-archives/:messageId/verify', async (req: AuthRequest, res: Response) => {
  const companyId = resolveGovernanceCompanyId(req, res);
  if (!companyId) {
    return;
  }
  const content = typeof req.query.content === 'string' ? req.query.content : '';
  const valid = await messageArchiveService.verifyIntegrity(companyId, req.params.messageId, content);
  res.json({ valid });
});

export default router;
