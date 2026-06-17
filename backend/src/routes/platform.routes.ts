import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { buildEnterpriseBaselineReport } from '../services/platformMaturity.service';
import { getPlatformRedisStatus } from '../services/platformRuntime.service';
import { buildSloSnapshot } from '../services/observability/slo.service';
import { sendTestAlert } from '../services/observability/sloAlert.service';
import { buildExitGateReport } from '../services/platformExitGate.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('super_admin'));

router.get('/maturity', async (_req: AuthRequest, res: Response) => {
  const redisStatus = await getPlatformRedisStatus();
  res.json(buildEnterpriseBaselineReport({ redisStatus }));
});

router.get('/observability', async (_req: AuthRequest, res: Response) => {
  const snapshot = await buildSloSnapshot();
  res.json({
    snapshot,
    dashboards: [
      'platform-overview',
      'whatsapp-pipeline',
      'ai-usage',
      'tenant-health',
      'slo-burn',
    ],
  });
});

router.post('/observability/test-alert', async (_req: AuthRequest, res: Response) => {
  const result = await sendTestAlert();
  res.status(result.ok ? 200 : 503).json(result);
});

router.get('/exit-gate', async (_req: AuthRequest, res: Response) => {
  const report = await buildExitGateReport();
  res.status(report.ready ? 200 : 503).json(report);
});

export default router;
