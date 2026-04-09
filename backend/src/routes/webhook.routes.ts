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
router.post(
  '/',
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
  async (req: Request, res: Response) => {
  // Log all incoming webhook requests for debugging
  logger.info('Webhook POST received', {
    hasSignature: !!req.headers['x-hub-signature-256'],
    bodyObject: req.body?.object,
    hasEntries: !!req.body?.entry?.length,
    ip: req.ip || req.headers['x-forwarded-for'],
  });

  const signatureHeader = req.headers['x-hub-signature-256'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const signatureCheck = verifyWebhookSignature(rawBody ?? req.body, signature);
  if (!signatureCheck.allowed) {
    logger.warn('Webhook signature verification failed', {
      reason: signatureCheck.reason,
      hasSignature: !!signature,
      hasAppSecret: !!config.whatsapp.appSecret,
      env: config.env,
    });
    res.status(403).json({ status: 'rejected', reason: signatureCheck.reason });
    return;
  }

  // Must respond quickly to satisfy Meta retry behavior.
  res.status(200).json({ status: 'received' });

  processWebhook(req.body)
    .then((summary) => {
      logger.info('Webhook processing summary', { summary });
    })
    .catch((err) => {
      logger.error('Webhook processing failed', { error: err.message });
    });
  },
);

/**
 * Verify the webhook payload signature from Meta.
 */
function verifyWebhookSignature(
  body: any,
  signature: string | undefined,
): { allowed: boolean; reason: string } {
  if (!config.whatsapp.appSecret) {
    if (config.env === 'production') {
      return { allowed: false, reason: 'app_secret_missing' };
    }

    logger.warn('WHATSAPP_APP_SECRET not configured - allowing webhook only in non-production');
    return { allowed: true, reason: 'non_prod_missing_app_secret' };
  }

  if (!signature) {
    if (config.env !== 'production') {
      return { allowed: true, reason: 'non_prod_missing_signature' };
    }

    return { allowed: false, reason: 'signature_missing' };
  }

  const payload = Buffer.isBuffer(body)
    ? body
    : typeof body === 'string'
      ? body
      : JSON.stringify(body);

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', config.whatsapp.appSecret)
    .update(payload)
    .digest('hex');

  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length) {
    return { allowed: false, reason: 'signature_invalid_length' };
  }

  const isValid = crypto.timingSafeEqual(actual, expected);
  return {
    allowed: isValid,
    reason: isValid ? 'signature_valid' : 'signature_mismatch',
  };
}

type WebhookMessageStatus = 'processed' | 'skipped' | 'duplicate' | 'failed';

interface WebhookMessageOutcome {
  messageId: string | null;
  type: string | null;
  from: string | null;
  status: WebhookMessageStatus;
  reason: string;
  propagationStatus: 'success' | 'failed' | 'not_attempted';
  error?: string;
}

interface WebhookProcessSummary {
  object: string | null;
  totalMessages: number;
  processed: number;
  skipped: number;
  duplicate: number;
  failed: number;
  outcomes: WebhookMessageOutcome[];
}

/**
 * Process incoming webhook payload from Meta.
 */
async function processWebhook(body: any): Promise<WebhookProcessSummary> {
  const summary: WebhookProcessSummary = {
    object: body?.object || null,
    totalMessages: 0,
    processed: 0,
    skipped: 0,
    duplicate: 0,
    failed: 0,
    outcomes: [],
  };

  logger.info('=== PROCESS WEBHOOK START ===', {
    object: body.object,
    entryCount: body.entry?.length || 0,
    fullBody: JSON.stringify(body).substring(0, 500),
  });

  if (body.object !== 'whatsapp_business_account') {
    logger.warn('Ignoring non-WhatsApp webhook', { object: body.object });
    summary.skipped += 1;
    summary.outcomes.push({
      messageId: null,
      type: null,
      from: null,
      status: 'skipped',
      reason: 'unsupported_object',
      propagationStatus: 'not_attempted',
    });
    return summary;
  }
  
  logger.info('Object check passed, processing entries...');

  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    logger.info('Processing entry', { entryId: entry.id, changeCount: changes.length });
    
    for (const change of changes) {
      logger.info('Processing change', { field: change.field, hasValue: !!change.value });
      if (change.field !== 'messages') {
        logger.info('Skipping non-messages field', { field: change.field });
        continue;
      }

      const value = change.value;
      const metadata = value.metadata;
      const phoneNumberId = metadata?.phone_number_id;
      const messages = value.messages || [];
      const contacts = value.contacts || [];

      logger.info('=== MESSAGE PAYLOAD ===', {
        phoneNumberId,
        messageCount: messages.length,
        contactCount: contacts.length,
        hasMetadata: !!metadata,
      });

      for (let i = 0; i < messages.length; i++) {
        summary.totalMessages += 1;

        const message = messages[i];
        const contact = contacts[i];
        const messageId = message?.id || null;
        const outcome: WebhookMessageOutcome = {
          messageId,
          type: message?.type || null,
          from: message?.from || null,
          status: 'skipped',
          reason: 'uninitialized',
          propagationStatus: 'not_attempted',
        };

        logger.info('=== PROCESSING MESSAGE ===', {
          index: i,
          type: message.type,
          id: message.id,
          from: message.from,
          hasContact: !!contact,
        });

        const extracted = extractCustomerMessage(message);
        if (!extracted) {
          outcome.status = 'skipped';
          outcome.reason = 'unsupported_message_type';
          summary.skipped += 1;
          summary.outcomes.push(outcome);
          logger.info('Skipping unsupported message type', { type: message.type, messageId });
          continue;
        }

        if (!messageId) {
          outcome.status = 'skipped';
          outcome.reason = 'missing_message_id';
          summary.skipped += 1;
          summary.outcomes.push(outcome);
          logger.warn('Skipping message without message.id');
          continue;
        }

        const customerPhone = message.from; // E.164 format without +
        if (!customerPhone) {
          outcome.status = 'skipped';
          outcome.reason = 'missing_customer_phone';
          summary.skipped += 1;
          summary.outcomes.push(outcome);
          logger.warn('Skipping message without sender phone', { messageId });
          continue;
        }

        const isClaimed = await deduplicationService.claimMessageProcessing(messageId);
        if (!isClaimed) {
          outcome.status = 'duplicate';
          outcome.reason = 'duplicate_message_id';
          summary.duplicate += 1;
          summary.outcomes.push(outcome);
          logger.info('Duplicate message ignored', { messageId });
          continue;
        }

        const customerName = contact?.profile?.name || '';
        const { messageText, normalizedType } = extracted;

        logger.info('=== CALLING handleIncomingMessage ===', {
          phoneNumberId,
          customerPhone: customerPhone.substring(0, 6) + '****', // Mask phone in logs
          customerName,
          text: messageText.substring(0, 50),
          normalizedType,
          interactiveId: extracted.interactiveId,
          interactiveType: extracted.interactiveType,
        });

        try {
          const processingResult = await whatsappService.handleIncomingMessage({
            phoneNumberId,
            customerPhone: '+' + customerPhone,
            customerName,
            messageText,
            messageId,
            interactiveId: extracted.interactiveId,
            interactiveType: extracted.interactiveType,
          });

          outcome.propagationStatus = processingResult.propagation.status;

          if (processingResult.status === 'processed') {
            outcome.status = 'processed';
            outcome.reason = 'message_processed';
            summary.processed += 1;
          } else if (processingResult.status === 'skipped') {
            outcome.status = 'skipped';
            outcome.reason = processingResult.reason || 'service_skipped';
            summary.skipped += 1;
          } else {
            outcome.status = 'failed';
            outcome.reason = processingResult.reason || 'service_failed';
            summary.failed += 1;
            await deduplicationService.release(messageId);
          }

          summary.outcomes.push(outcome);
          logger.info('=== MESSAGE HANDLED SUCCESSFULLY ===', { messageId });
        } catch (err: any) {
          await deduplicationService.release(messageId);
          outcome.status = 'failed';
          outcome.reason = 'exception';
          outcome.error = err.message;
          summary.failed += 1;
          summary.outcomes.push(outcome);
          logger.error('=== MESSAGE HANDLING FAILED ===', { 
            messageId, 
            error: err.message,
            stack: err.stack?.substring(0, 500),
          });
        }
      }
    }
  }

  return summary;
}

function extractCustomerMessage(message: any): { 
  messageText: string; 
  normalizedType: 'text' | 'interactive';
  interactiveId?: string;
  interactiveType?: 'button_reply' | 'list_reply';
} | null {
  if (message.type === 'text' && typeof message.text?.body === 'string') {
    return {
      messageText: message.text.body,
      normalizedType: 'text',
    };
  }

  if (message.type === 'interactive') {
    // Handle button replies (quick reply buttons)
    if (message.interactive?.button_reply) {
      const buttonReply = message.interactive.button_reply;
      return {
        messageText: buttonReply.title || '',
        normalizedType: 'interactive',
        interactiveId: buttonReply.id,
        interactiveType: 'button_reply',
      };
    }

    // Handle list replies (scrollable list selections)
    if (message.interactive?.list_reply) {
      const listReply = message.interactive.list_reply;
      // Use description if title is too short, otherwise title
      const text = listReply.description || listReply.title || '';
      return {
        messageText: text,
        normalizedType: 'interactive',
        interactiveId: listReply.id,
        interactiveType: 'list_reply',
      };
    }

    return null;
  }

  return null;
}

export const webhookRouteInternals = {
  verifyWebhookSignature,
  processWebhook,
  extractCustomerMessage,
};

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
router.post('/test', express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
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

/**
 * POST /api/webhook/debug
 * Debug endpoint to test the full webhook flow synchronously.
 * Returns detailed step-by-step info about what happens.
 * TEMPORARY - remove after debugging.
 */
router.post('/debug', express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
  const debugLog: string[] = [];
  const log = (msg: string) => {
    debugLog.push(`[${new Date().toISOString()}] ${msg}`);
    logger.info(`DEBUG: ${msg}`);
  };

  try {
    log('Starting debug webhook processing');
    
    const body = req.body;
    log(`Body object: ${body.object}`);
    log(`Entry count: ${body.entry?.length || 0}`);

    if (body.object !== 'whatsapp_business_account') {
      log('ERROR: Not a whatsapp_business_account object');
      res.json({ success: false, debugLog });
      return;
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      log(`Entry has ${changes.length} changes`);

      for (const change of changes) {
        log(`Change field: ${change.field}`);
        if (change.field !== 'messages') {
          log('Skipping non-messages change');
          continue;
        }

        const value = change.value;
        const metadata = value.metadata;
        const phoneNumberId = metadata?.phone_number_id;
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        log(`Phone Number ID: ${phoneNumberId}`);
        log(`Messages: ${messages.length}, Contacts: ${contacts.length}`);

        // Try to find company
        log('Looking up company by phoneNumberId...');
        const companyResult = await whatsappService.getCompanyByPhoneNumberId(phoneNumberId);
        
        if (!companyResult) {
          log('ERROR: No company found for phoneNumberId!');
          res.json({ success: false, error: 'No company found', debugLog });
          return;
        }

        log(`Found company: ${companyResult.company.name} (${companyResult.company.id})`);

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          const contact = contacts[i];

          log(`Message ${i}: type=${message.type}, from=${message.from}`);
          
          if (message.type !== 'text') {
            log('Skipping non-text message');
            continue;
          }

          const customerPhone = '+' + message.from;
          const customerName = contact?.profile?.name || '';
          const messageText = message.text?.body || '';

          log(`Processing: phone=${customerPhone}, name=${customerName}, text=${messageText}`);

          // Call handleIncomingMessage
          log('Calling whatsappService.handleIncomingMessage...');
          await whatsappService.handleIncomingMessage({
            phoneNumberId,
            customerPhone,
            customerName,
            messageText,
            messageId: message.id,
          });

          log('handleIncomingMessage completed successfully');
        }
      }
    }

    // Check if lead was created
    const prisma = (await import('../config/prisma')).default;
    const recentLeads = await prisma.lead.findMany({
      where: { companyId: entries[0]?.changes?.[0]?.value?.metadata?.phone_number_id ? undefined : undefined },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    log(`Recent leads in DB: ${recentLeads.length}`);
    recentLeads.forEach((l: any, i: number) => {
      log(`Lead ${i}: ${l.phone} - ${l.customerName} - ${l.createdAt}`);
    });

    res.json({ success: true, debugLog, recentLeads: recentLeads.map((l: any) => ({ id: l.id, phone: l.phone, name: l.customerName })) });
  } catch (err: any) {
    log(`EXCEPTION: ${err.message}`);
    log(`Stack: ${err.stack?.substring(0, 500)}`);
    res.json({ success: false, error: err.message, debugLog });
  }
});

export default router;
