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

router.get('/prompts', async (req: AuthRequest, res: Response) => {
  const name = typeof req.query.name === 'string' ? req.query.name : undefined;
  const versions = await promptVersionService.listVersions(name);
  res.json({ versions, enabled: promptVersionService.isEnabled() });
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
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const items = await aiReviewQueueService.listPending(companyId);
  res.json({ items, enabled: aiReviewQueueService.isEnabled(), threshold: aiReviewQueueService.getRiskThreshold() });
});

router.post('/ai-review-queue/:id/review', async (req: AuthRequest, res: Response) => {
  if (!config.features.aiReviewQueue) {
    res.status(503).json({ error: 'FEATURE_AI_REVIEW_QUEUE is disabled' });
    return;
  }
  const companyId = req.user?.company_id;
  const userId = req.user?.id;
  if (!companyId || !userId) {
    res.status(400).json({ error: 'Company context required' });
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
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
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
  const companyId = req.user?.company_id;
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const content = typeof req.query.content === 'string' ? req.query.content : '';
  const valid = await messageArchiveService.verifyIntegrity(companyId, req.params.messageId, content);
  res.json({ valid });
});

export default router;
