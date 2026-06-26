import express, { Request, Response, Router } from 'express';
import { Webhook } from 'svix';
import logger from '../config/logger';
import {
  applyResendEmailEventToAgencyInvite,
  ResendEmailWebhookEvent,
} from '../services/resendWebhook.service';

const router = Router();

function getWebhookSecret(): string {
  return (process.env.RESEND_WEBHOOK_SECRET || '').trim();
}

function readRawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body ?? {});
}

function verifyResendWebhook(req: Request): { event: ResendEmailWebhookEvent; deliveryId: string } {
  const secret = getWebhookSecret();
  if (!secret) {
    throw new Error('RESEND_WEBHOOK_SECRET is not configured');
  }

  const deliveryId = req.header('svix-id') || '';
  const timestamp = req.header('svix-timestamp') || '';
  const signature = req.header('svix-signature') || '';
  if (!deliveryId || !timestamp || !signature) {
    throw new Error('Missing Resend Svix signature headers');
  }

  const webhook = new Webhook(secret);
  const event = webhook.verify(readRawBody(req), {
    'svix-id': deliveryId,
    'svix-timestamp': timestamp,
    'svix-signature': signature,
  }) as ResendEmailWebhookEvent;

  return { event, deliveryId };
}

router.get('/', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'resend-webhook',
    configured: Boolean(getWebhookSecret()),
  });
});

router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req: Request, res: Response) => {
  let verified: { event: ResendEmailWebhookEvent; deliveryId: string };
  try {
    verified = verifyResendWebhook(req);
  } catch (err: unknown) {
    logger.warn('Resend webhook signature verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(400).json({ error: 'Invalid webhook' });
    return;
  }

  try {
    const result = await applyResendEmailEventToAgencyInvite(verified.event, verified.deliveryId);
    res.json({ ok: true, result });
  } catch (err: unknown) {
    logger.error('Resend webhook handler failed', {
      error: err instanceof Error ? err.message : String(err),
      eventType: verified.event.type,
      deliveryId: verified.deliveryId,
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
