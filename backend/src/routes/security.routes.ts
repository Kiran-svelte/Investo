import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { runSecuritySelfCheck } from '../services/securityScan.service';
import { secretsService } from '../services/secrets.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('super_admin'));

router.get('/scan', async (_req: AuthRequest, res: Response) => {
  res.json({ data: runSecuritySelfCheck() });
});

router.get('/secrets/rotations', async (_req: AuthRequest, res: Response) => {
  const rows = await secretsService.listRecentRotations();
  res.json({ data: rows });
});

router.post('/secrets/:name/rotate', async (req: AuthRequest, res: Response) => {
  const secretName = req.params.name;
  await secretsService.recordRotation(secretName, req.user!.id);
  res.json({ success: true, message: `Rotation recorded for ${secretName}` });
});

export default router;
