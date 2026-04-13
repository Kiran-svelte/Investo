import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import config from '../config';
import logger from '../config/logger';
import { deduplicationService } from '../services/deduplication.service';
import { whatsappService } from '../services/whatsapp.service';
import { maskPhoneNumberForLogs } from '../utils/maskPhoneNumberForLogs';

const router = Router();

type GreenApiWebhookMessageStatus = 'processed' | 'skipped' | 'duplicate' | 'failed';

interface GreenApiWebhookMessageOutcome {
  messageId: string | null;
  from: string | null;
  typeWebhook: string | null;
  typeMessage: string | null;
  status: GreenApiWebhookMessageStatus;
  reason: string;
  propagationStatus: 'success' | 'failed' | 'not_attempted';
  error?: string;
}

interface GreenApiWebhookProcessSummary {
  totalNotifications: number;
  totalMessages: number;
  processed: number;
  skipped: number;
  duplicate: number;
  failed: number;
  outcomes: GreenApiWebhookMessageOutcome[];
}

router.post(
  '/',
  express.json({ limit: '1mb' }),
  async (req: Request, res: Response) => {
    const providedToken = extractAuthorizationToken(req.headers.authorization);
    if (config.env === 'production' && !(config as any)?.whatsapp?.allowGreenapiInProd) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    if (!providedToken) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const globalToken = extractAuthorizationToken(config.greenapi.webhookUrlToken);

    // Fail closed in GreenAPI mode: require deterministic instance→company mapping before ack.
    const extracted = extractIncomingTextNotifications(req.body);
    if (extracted.length > 0) {
      const instanceIds = new Set(
        extracted
          .map((item) => item.instanceId)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      );

      if (instanceIds.size === 0) {
        res.status(422).json({ error: 'missing_instance_identifier', code: 'greenapi_missing_instance_identifier' });
        return;
      }

      if (instanceIds.size > 1) {
        res.status(422).json({ error: 'multiple_instance_identifiers', code: 'greenapi_multiple_instance_identifiers' });
        return;
      }

      const [instanceId] = Array.from(instanceIds);
      const companyResult = await whatsappService.getCompanyByPhoneNumberId(instanceId, 'greenapi');
      if (!companyResult) {
        res.status(404).json({ error: 'company_not_found', code: 'greenapi_company_not_found' });
        return;
      }

      const companySettings = (companyResult.company?.settings as any) || {};
      const companyWhatsapp = (companySettings.whatsapp as any) || {};
      const companyGreenApi = (companyWhatsapp.greenapi as any) || {};
      const companyToken = extractAuthorizationToken(
        companyGreenApi.webhookUrlToken || companyWhatsapp.webhookUrlToken || undefined,
      );

      const effectiveExpectedToken = companyToken || globalToken;
      if (!effectiveExpectedToken) {
        logger.error('GreenAPI webhook token not configured');
        res.status(500).json({ error: 'webhook_token_not_configured' });
        return;
      }

      const authorized =
        timingSafeEquals(providedToken, effectiveExpectedToken) ||
        (globalToken ? timingSafeEquals(providedToken, globalToken) : false);

      if (!authorized) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
    } else {
      if (!globalToken) {
        logger.error('GreenAPI webhook token not configured');
        res.status(500).json({ error: 'webhook_token_not_configured' });
        return;
      }

      if (!timingSafeEquals(providedToken, globalToken)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
    }

    // Respond quickly; process async to avoid webhook retries.
    res.status(200).json({ status: 'received' });

    processGreenApiWebhook(req.body)
      .then((summary) => {
        logger.info('GreenAPI webhook processing summary', { summary: redactGreenApiSummaryForLogs(summary) });
      })
      .catch((err: any) => {
        logger.error('GreenAPI webhook processing failed', { error: err.message });
      });
  },
);

function extractAuthorizationToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(?:Bearer|Basic)\s+(.+)$/i);
  return (match ? match[1] : trimmed).trim();
}

function timingSafeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuf, bBuf);
}

function normalizeSenderToE164Like(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 8) {
    return null;
  }

  return `+${digits}`;
}

function normalizeInstanceIdentifier(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function extractGreenApiInstanceIdentifier(notification: any): string | null {
  const idInstance = normalizeInstanceIdentifier(notification?.instanceData?.idInstance);
  if (idInstance) {
    return idInstance;
  }

  const wid = normalizeInstanceIdentifier(notification?.instanceData?.wid ?? notification?.wid);
  return wid;
}

function redactGreenApiSummaryForLogs(summary: GreenApiWebhookProcessSummary): GreenApiWebhookProcessSummary {
  return {
    ...summary,
    outcomes: summary.outcomes.map((outcome) => ({
      ...outcome,
      from: maskPhoneNumberForLogs(outcome.from),
    })),
  };
}

function extractTextFromGreenApiMessageData(messageData: any): string | null {
  if (!messageData || typeof messageData !== 'object') {
    return null;
  }

  const typeMessage = messageData.typeMessage;

  if (typeMessage === 'textMessage') {
    const text = messageData.textMessageData?.textMessage;
    return typeof text === 'string' ? text : null;
  }

  if (typeMessage === 'extendedTextMessage') {
    const text = messageData.extendedTextMessageData?.text;
    return typeof text === 'string' ? text : null;
  }

  const candidates = [
    messageData.textMessageData?.textMessage,
    messageData.extendedTextMessageData?.text,
    messageData.text,
    messageData.message,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return null;
}

function isIncomingMessageNotification(notification: any): boolean {
  const typeWebhook = notification?.typeWebhook;
  if (typeof typeWebhook !== 'string') {
    return false;
  }

  return typeWebhook.trim().toLowerCase() === 'incomingmessagereceived';
}

type ExtractedIncomingText = {
  instanceId: string | null;
  messageId: string | null;
  customerPhone: string | null;
  customerName: string;
  messageText: string | null;
  typeWebhook: string | null;
  typeMessage: string | null;
};

function extractIncomingTextNotifications(body: any): ExtractedIncomingText[] {
  const notifications = Array.isArray(body) ? body : [body];
  const extracted: ExtractedIncomingText[] = [];

  for (const notification of notifications) {
    if (!isIncomingMessageNotification(notification)) {
      continue;
    }

    const messageId = typeof notification?.idMessage === 'string' ? notification.idMessage : null;
    const senderData = notification?.senderData;
    const messageData = notification?.messageData;

    const typeWebhook = typeof notification?.typeWebhook === 'string' ? notification.typeWebhook : null;
    const typeMessage = typeof messageData?.typeMessage === 'string' ? messageData.typeMessage : null;

    const rawSender = senderData?.sender ?? senderData?.chatId ?? null;
    const customerPhone = normalizeSenderToE164Like(rawSender);

    const customerNameRaw =
      (typeof senderData?.senderName === 'string' && senderData.senderName) ||
      (typeof senderData?.senderContactName === 'string' && senderData.senderContactName) ||
      '';

    const messageText = extractTextFromGreenApiMessageData(messageData);
    const instanceId = extractGreenApiInstanceIdentifier(notification);

    extracted.push({
      instanceId,
      messageId,
      customerPhone,
      customerName: customerNameRaw,
      messageText,
      typeWebhook,
      typeMessage,
    });
  }

  return extracted;
}

async function processGreenApiWebhook(body: any): Promise<GreenApiWebhookProcessSummary> {
  const summary: GreenApiWebhookProcessSummary = {
    totalNotifications: Array.isArray(body) ? body.length : 1,
    totalMessages: 0,
    processed: 0,
    skipped: 0,
    duplicate: 0,
    failed: 0,
    outcomes: [],
  };

  const extracted = extractIncomingTextNotifications(body);

  for (const msg of extracted) {
    summary.totalMessages += 1;

    const outcome: GreenApiWebhookMessageOutcome = {
      messageId: msg.messageId,
      from: msg.customerPhone,
      typeWebhook: msg.typeWebhook,
      typeMessage: msg.typeMessage,
      status: 'skipped',
      reason: 'uninitialized',
      propagationStatus: 'not_attempted',
    };

    if (!msg.messageId) {
      outcome.status = 'skipped';
      outcome.reason = 'missing_message_id';
      summary.skipped += 1;
      summary.outcomes.push(outcome);
      continue;
    }

    if (!msg.instanceId) {
      outcome.status = 'skipped';
      outcome.reason = 'missing_instance_identifier';
      summary.skipped += 1;
      summary.outcomes.push(outcome);
      continue;
    }

    if (!msg.customerPhone) {
      outcome.status = 'skipped';
      outcome.reason = 'missing_sender_phone';
      summary.skipped += 1;
      summary.outcomes.push(outcome);
      continue;
    }

    if (typeof msg.messageText !== 'string') {
      outcome.status = 'skipped';
      outcome.reason = 'unsupported_message_type';
      summary.skipped += 1;
      summary.outcomes.push(outcome);
      continue;
    }

    const phoneNumberId = msg.instanceId;
    const dedupKey = `greenapi:${phoneNumberId}:${msg.messageId}`;

    const isClaimed = await deduplicationService.claimMessageProcessing(dedupKey);
    if (!isClaimed) {
      outcome.status = 'duplicate';
      outcome.reason = 'duplicate_message_id';
      summary.duplicate += 1;
      summary.outcomes.push(outcome);
      continue;
    }

    try {
      const result = await whatsappService.handleIncomingMessage({
        provider: 'greenapi',
        phoneNumberId,
        customerPhone: msg.customerPhone,
        customerName: msg.customerName,
        messageText: msg.messageText,
        messageId: msg.messageId,
      });

      outcome.propagationStatus = result.propagation.status;

      if (result.status === 'processed') {
        outcome.status = 'processed';
        outcome.reason = 'message_processed';
        summary.processed += 1;
      } else if (result.status === 'skipped') {
        outcome.status = 'skipped';
        outcome.reason = result.reason || 'service_skipped';
        summary.skipped += 1;
      } else {
        outcome.status = 'failed';
        outcome.reason = result.reason || 'service_failed';
        summary.failed += 1;
        await deduplicationService.release(dedupKey);
      }

      summary.outcomes.push(outcome);
    } catch (err: any) {
      await deduplicationService.release(dedupKey);
      outcome.status = 'failed';
      outcome.reason = 'exception';
      outcome.error = err.message;
      summary.failed += 1;
      summary.outcomes.push(outcome);
    }
  }

  return summary;
}

export const greenApiWebhookRouteInternals = {
  extractAuthorizationToken,
  timingSafeEquals,
  normalizeSenderToE164Like,
  extractGreenApiInstanceIdentifier,
  extractTextFromGreenApiMessageData,
  extractIncomingTextNotifications,
  processGreenApiWebhook,
};

export default router;
