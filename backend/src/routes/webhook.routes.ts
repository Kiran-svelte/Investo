import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import config from '../config';
import logger from '../config/logger';
import { whatsappService } from '../services/whatsapp.service';
import { whatsappIpWhitelist } from '../middleware/whatsappSecurity';
import { deduplicationService } from '../services/deduplication.service';
import { whatsappHealthService } from '../services/whatsappHealth.service';

const router = Router();

// Apply IP whitelist middleware to all webhook routes
router.use(whatsappIpWhitelist);

/**
 * GET /api/webhook
 * WhatsApp webhook verification endpoint - no auth required.
 * Meta sends a challenge that must be echoed back.
 */
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
    return;
  }

  res.status(403).json({ error: 'Webhook verification failed' });
});

/**
 * POST /api/webhook
 * WhatsApp incoming message handler.
 * Verifies Meta signature before processing.
 * 
 * Applies webhook-specific size limit: 1mb (not the global 10mb)
 */
router.post('/', express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
  // Must respond 200 within 5 seconds (Meta requirement)
  res.status(200).json({ status: 'received' });

  // Verify signature
  const signature = req.headers['x-hub-signature-256'] as string;
  if (!verifyWebhookSignature(req.body, signature)) {
    logger.warn('Invalid webhook signature - possible spoofing attempt');
    return;
  }

  // Check for duplicate messages
  const messageId = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
  if (messageId) {
    const isDuplicate = await deduplicationService.isDuplicate(messageId);
    if (isDuplicate) {
      logger.info('Duplicate message ignored', { messageId });
      return;
    }
    // Mark as processed immediately to prevent duplicates during processing
    await deduplicationService.markProcessed(messageId);
  }

  // Process asynchronously
  processWebhook(req.body).catch((err) => {
    logger.error('Webhook processing failed', { error: err.message });
  });
});

/**
 * Verify the webhook payload signature from Meta.
 */
function verifyWebhookSignature(body: any, signature: string): boolean {
  if (!signature || !config.whatsapp.appSecret) {
    // In dev, allow without signature if no secret configured
    if (config.env === 'development') return true;
    return false;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', config.whatsapp.appSecret)
    .update(JSON.stringify(body))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Process incoming webhook payload from Meta.
 */
async function processWebhook(body: any): Promise<void> {
  if (body.object !== 'whatsapp_business_account') return;

  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      const metadata = value.metadata;
      const phoneNumberId = metadata?.phone_number_id;
      const messages = value.messages || [];
      const contacts = value.contacts || [];

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const contact = contacts[i];

        if (message.type !== 'text') continue;

        const customerPhone = message.from; // E.164 format without +
        const customerName = contact?.profile?.name || '';
        const messageText = message.text?.body || '';
        const messageId = message.id;

        logger.info('Incoming WhatsApp message', {
          from: customerPhone.substring(0, 6) + '****', // Mask phone in logs
          phoneNumberId,
        });

        await whatsappService.handleIncomingMessage({
          phoneNumberId,
          customerPhone: '+' + customerPhone,
          customerName,
          messageText,
          messageId,
        });
      }
    }
  }
}

/**
 * GET /api/webhook/health
 * WhatsApp connection health check endpoint.
 * Returns the current status of WhatsApp API connectivity.
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await whatsappHealthService.getHealthStatus();
    
    // Return appropriate status code based on WhatsApp connection
    const statusCode = health.whatsapp.connected ? 200 : 503;
    
    res.status(statusCode).json(health);
  } catch (err: any) {
    logger.error('Health check failed', { error: err.message });
    res.status(500).json({
      error: 'Health check failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/webhook/test
 * Simulate a WhatsApp message for testing (dev mode only).
 * Body: { phone, name, message }
 */
router.post('/test', async (req: Request, res: Response) => {
  if (config.env !== 'development') {
    res.status(403).json({ error: 'Test endpoint only available in development' });
    return;
  }

  const { phone, name, message } = req.body;
  if (!phone || !message) {
    res.status(400).json({ error: 'phone and message are required' });
    return;
  }

  try {
    await whatsappService.handleIncomingMessage({
      phoneNumberId: 'test',
      customerPhone: phone,
      customerName: name || 'Test Customer',
      messageText: message,
      messageId: `test_${Date.now()}`,
    });

    // Get the latest conversation and AI response
    const lead = await (await import('../config/prisma')).default.lead.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });

    if (!lead) {
      res.json({ message: 'Message processed but no lead found' });
      return;
    }

    const conversation = await (await import('../config/prisma')).default.conversation.findFirst({
      where: { leadId: lead.id },
      orderBy: { updatedAt: 'desc' },
    });

    const messages = conversation
      ? await (await import('../config/prisma')).default.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'desc' },
          take: 2,
        })
      : [];

    res.json({
      data: {
        leadId: lead.id,
        conversationId: conversation?.id,
        messages: messages.reverse().map((m: any) => ({
          sender: m.senderType,
          content: m.content,
          language: m.language,
          createdAt: m.createdAt,
        })),
      },
    });
  } catch (err: any) {
    logger.error('Test webhook failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
