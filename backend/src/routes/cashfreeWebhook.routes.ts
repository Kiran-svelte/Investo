import { Router, Request, Response } from 'express';
import config from '../config';
import logger from '../config/logger';
import {
  parseCashfreeWebhook,
  verifyCashfreeWebhookSignature,
} from '../services/billing/cashfree.service';
import { handleCashfreeWebhook } from '../services/billing/checkout.service';

const router = Router();

/**
 * Captures raw body for HMAC-SHA256 verification before express.json() re-serializes it.
 * Falls back to re-stringifying req.body if raw bytes are unavailable.
 */
function expressRawBody(req: Request, _res: Response, next: () => void): void {
  if ((req as Request & { rawBody?: string }).rawBody) {
    next();
    return;
  }
  (req as Request & { rawBody?: string }).rawBody = JSON.stringify(req.body ?? {});
  next();
}

/**
 * GET /api/webhooks/cashfree
 * Cashfree's dashboard "Test" button sends a GET ping to verify the endpoint is reachable.
 * Returns 200 so the connectivity test passes without triggering any business logic.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'cashfree-webhook' });
});

/**
 * POST /api/webhooks/cashfree
 * Receives Cashfree payment events (PAYMENT_SUCCESS, PAYMENT_FAILED, etc.).
 * Verifies HMAC-SHA256 signature using x-webhook-signature + x-webhook-timestamp headers.
 * @throws 401 if signature verification fails
 * @throws 410 if billing feature flag is disabled
 * @throws 500 if webhook processing fails internally
 */
router.post('/', expressRawBody, async (req: Request, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: 'Billing disabled' });
    return;
  }

  const rawBody = (req as Request & { rawBody?: string }).rawBody || JSON.stringify(req.body);
  const signature = req.headers['x-webhook-signature'] as string | undefined;
  const timestamp = req.headers['x-webhook-timestamp'] as string | undefined;

  if (!verifyCashfreeWebhookSignature(rawBody, signature, timestamp)) {
    logger.warn('Cashfree webhook signature verification failed');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  try {
    const payload = parseCashfreeWebhook(req.body);
    const orderId = payload.data?.order?.order_id;
    const paymentId = payload.data?.payment?.cf_payment_id;

    if (orderId) {
      await handleCashfreeWebhook(orderId, paymentId);
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    logger.error('Cashfree webhook handler failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
