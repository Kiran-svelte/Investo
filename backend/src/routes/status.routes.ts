import { Router, Request, Response } from 'express';

import config from '../config';
import { buildSloSnapshot } from '../services/observability/slo.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  if (!config.features?.publicStatusApi) {
    res.status(404).json({ error: 'status_api_disabled' });
    return;
  }

  const snapshot = await buildSloSnapshot();
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    status: snapshot.overall_status,
    generated_at: snapshot.generated_at,
    page_url: snapshot.external_links.status_page_url,
    components: snapshot.components.map((component) => ({
      id: component.id,
      name: component.name,
      status: component.status,
      detail: component.detail,
    })),
    incidents: [],
  });
});

router.get('/slo', async (_req: Request, res: Response) => {
  if (!config.features?.publicStatusApi) {
    res.status(404).json({ error: 'status_api_disabled' });
    return;
  }

  const snapshot = await buildSloSnapshot();
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    generated_at: snapshot.generated_at,
    overall_status: snapshot.overall_status,
    indicators: snapshot.indicators,
  });
});

export default router;
