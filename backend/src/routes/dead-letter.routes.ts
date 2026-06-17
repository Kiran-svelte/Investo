import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { deadLetterService } from '../services/queue/deadLetter.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('super_admin'));

router.get('/whatsapp', async (req: AuthRequest, res: Response) => {
  const limit = Number(req.query.limit || 50);
  const items = await deadLetterService.listWhatsAppDeadLetters(limit);
  res.json({ data: items });
});

router.post('/whatsapp/:id/replay', async (req: AuthRequest, res: Response) => {
  try {
    const result = await deadLetterService.replayWhatsAppDeadLetter(req.params.id);
    res.status(202).json({ data: result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to replay dead-letter job' });
  }
});

export default router;
