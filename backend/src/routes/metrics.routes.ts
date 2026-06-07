import { Router, Request, Response, NextFunction } from 'express';
import config from '../config';
import {
  getPrometheusMetrics,
  getPrometheusContentType,
} from '../services/prometheusMetrics.service';

const router = Router();

/**
 * Internal-only guard for the metrics scrape endpoint.
 * Accepts either a static Bearer token (METRICS_BEARER_TOKEN env var) or
 * requests originating from a private/loopback IP (CI smoke-tests, Prometheus
 * running on the same host, or a Render internal network).
 */
function metricsAuth(req: Request, res: Response, next: NextFunction): void {
  const metricsToken = process.env.METRICS_BEARER_TOKEN;

  // Allow loopback / private-range access without a token (Prometheus on same host)
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  const isPrivate =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('172.') ||
    ip.startsWith('192.168.');

  if (isPrivate) {
    next();
    return;
  }

  if (!metricsToken) {
    // In production without a token configured, block all external scraping.
    if (config.env === 'production') {
      res.status(403).json({ error: 'Metrics endpoint requires METRICS_BEARER_TOKEN in production' });
      return;
    }
    // Non-production: allow (dev convenience)
    next();
    return;
  }

  const authHeader = req.headers.authorization || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (provided !== metricsToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * GET /api/metrics
 * Prometheus scrape endpoint — protected by Bearer token or private-IP origin.
 */
router.get('/', metricsAuth, async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', getPrometheusContentType());
  res.status(200).send(await getPrometheusMetrics());
});

export default router;
