import { Router, Request, Response } from 'express';
import config from '../config';
import logger from '../config/logger';
import {
  parseCashfreeWebhook,
  verifyCashfreeWebhookSignature,
} from '../services/billing/cashfree.service';
import { handleCashfreeWebhook } from '../services/billing/checkout.service';

const router = Router();

/** POST /api/webhooks/cashfree — Cashfree payment webhook */
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

function expressRawBody(req: Request, _res: Response, next: () => void): void {
  if ((req as Request & { rawBody?: string }).rawBody) {
    next();
    return;
  }
  (req as Request & { rawBody?: string }).rawBody = JSON.stringify(req.body ?? {});
  next();
}

export default router;
