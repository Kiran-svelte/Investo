import { Router, Request, Response } from 'express';
import {
  getPrometheusMetrics,
  getPrometheusContentType,
} from '../services/prometheusMetrics.service';

const router = Router();

/**
 * GET /api/metrics
 * Prometheus scrape endpoint with HTTP latency histograms (p50/p95/p99 via prom-client).
 */
router.get('/', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', getPrometheusContentType());
  res.status(200).send(await getPrometheusMetrics());
});

export default router;
