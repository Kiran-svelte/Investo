import { createHash } from 'crypto';
import { deduplicationService } from './deduplication.service';
import logger from '../config/logger';

const INBOUND_KEY_PREFIX = 'inbound:';
const STAFF_PROCESSING_PREFIX = 'staff-processing:';
const CUSTOMER_PROCESSING_PREFIX = 'customer-processing:';
const STAFF_FINGERPRINT_PREFIX = 'staff-fp:';
const OUTBOUND_AI_PREFIX = 'outbound-ai:';
const OUTBOUND_TURN_PREFIX = 'outbound-turn:';
const OUTBOUND_COPILOT_PREFIX = 'outbound-copilot:';
const AGENT_ACTION_PREFIX = 'agent-action:';

/** TTL for in-flight staff copilot lock (prevents parallel duplicate replies). */
const STAFF_PROCESSING_TTL_SECONDS = 45;
/** TTL for in-flight customer AI processing lock. */
const CUSTOMER_PROCESSING_TTL_SECONDS = 60;

/**
 * Unified inbound dedup key shared by Meta webhooks and handleIncomingMessage.
 */
export function buildInboundDedupKey(companyId: string, messageId: string): string {
  return `${INBOUND_KEY_PREFIX}${companyId}:${messageId}`;
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as NodeJS.ErrnoException & { code?: string }).code === 'P2002'
  );
}

/**
 * DB-level idempotency — survives multi-instance Railway deploys and Redis outages.
 * Returns false when this companyId + messageId was already processed.
 */
export async function claimInboundMessageDb(
  companyId: string,
  messageId: string,
  senderPhone?: string | null,
): Promise<boolean> {
  const trimmed = messageId.trim();
  if (!trimmed) return true;

  try {
    const prisma = (await import('../config/prisma')).default;
    await prisma.inboundWhatsappDedup.create({
      data: {
        companyId,
        whatsappMessageId: trimmed,
        senderPhone: senderPhone?.trim() || null,
      },
    });
    return true;
  } catch (err: unknown) {
    if (isPrismaUniqueViolation(err)) {
      logger.info('Inbound message DB dedup: duplicate blocked', {
        companyId,
        whatsappMessageId: trimmed,
      });
      return false;
    }
    logger.warn('Inbound message DB dedup failed — falling back to Redis only', {
      companyId,
      whatsappMessageId: trimmed,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * Claim an inbound WhatsApp message for processing (idempotent).
 * Returns false when the same messageId was already claimed inside TTL.
 */
export async function claimInboundMessage(
  companyId: string,
  messageId: string | undefined | null,
): Promise<boolean> {
  if (!messageId?.trim()) return true;
  const key = buildInboundDedupKey(companyId, messageId.trim());
  const claimed = await deduplicationService.claimMessageProcessing(key);
  if (!claimed) {
    logger.info('Inbound message dedup: duplicate blocked', {
      companyId,
      whatsappMessageId: messageId,
    });
  }
  return claimed;
}

/**
 * Full inbound claim: DB (cross-instance) then Redis (fast path).
 */
export async function claimInboundMessageFull(
  companyId: string,
  messageId: string | undefined | null,
  senderPhone?: string | null,
): Promise<boolean> {
  if (!messageId?.trim()) return true;
  const dbClaimed = await claimInboundMessageDb(companyId, messageId, senderPhone);
  if (!dbClaimed) return false;
  return claimInboundMessage(companyId, messageId);
}

export async function releaseInboundMessage(
  companyId: string,
  messageId: string | undefined | null,
): Promise<void> {
  if (!messageId?.trim()) return;
  await deduplicationService.release(buildInboundDedupKey(companyId, messageId.trim()));
}

/**
 * Full release: delete the DB dedup record AND release the Redis key.
 * Use this when processing fails catastrophically so Meta's retry attempt
 * can be processed rather than being silently dropped as a duplicate.
 *
 * IMPORTANT: Only call on true processing failures (not on fallback replies that
 * successfully sent content to the customer — those should remain claimed).
 */
export async function releaseInboundMessageFull(
  companyId: string,
  messageId: string | undefined | null,
): Promise<void> {
  if (!messageId?.trim()) return;
  const trimmed = messageId.trim();

  // Release Redis key first (best-effort)
  await deduplicationService.release(buildInboundDedupKey(companyId, trimmed));

  // Delete the DB dedup record so the next Meta retry can be processed
  try {
    const prisma = (await import('../config/prisma')).default;
    await prisma.inboundWhatsappDedup.deleteMany({
      where: { companyId, whatsappMessageId: trimmed },
    });
    logger.info('Released inbound message dedup (DB + Redis) for retry', { companyId, messageId: trimmed });
  } catch (err: unknown) {
    logger.warn('releaseInboundMessageFull: DB delete failed — Redis key released but DB record remains', {
      companyId,
      messageId: trimmed,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Short-lived lock while staff copilot generates/sends a reply.
 * Blocks concurrent processing for the same staff user (double webhook / rapid taps).
 */
export async function claimStaffCopilotTurn(
  companyId: string,
  userId: string,
): Promise<boolean> {
  const key = `${STAFF_PROCESSING_PREFIX}${companyId}:${userId}`;
  const claimed = await deduplicationService.claimMessageProcessing(
    key,
    STAFF_PROCESSING_TTL_SECONDS,
  );
  if (!claimed) {
    logger.info('Staff copilot turn dedup: concurrent inbound blocked', {
      companyId,
      userId,
    });
  }
  return claimed;
}

export async function releaseStaffCopilotTurn(
  companyId: string,
  userId: string,
): Promise<void> {
  const key = `${STAFF_PROCESSING_PREFIX}${companyId}:${userId}`;
  await deduplicationService.release(key);
}

/**
 * Short-lived lock while customer AI pipeline runs for one phone number.
 */
export async function claimCustomerProcessingTurn(
  companyId: string,
  phone: string,
): Promise<boolean> {
  const phoneKey = phone.replace(/\D/g, '').slice(-10);
  if (!phoneKey) return true;
  const key = `${CUSTOMER_PROCESSING_PREFIX}${companyId}:${phoneKey}`;
  const claimed = await deduplicationService.claimMessageProcessing(
    key,
    CUSTOMER_PROCESSING_TTL_SECONDS,
  );
  if (!claimed) {
    logger.info('Customer processing turn dedup: concurrent inbound blocked', {
      companyId,
      phoneKey,
    });
  }
  return claimed;
}

export async function releaseCustomerProcessingTurn(
  companyId: string,
  phone: string,
): Promise<void> {
  const phoneKey = phone.replace(/\D/g, '').slice(-10);
  if (!phoneKey) return;
  const key = `${CUSTOMER_PROCESSING_PREFIX}${companyId}:${phoneKey}`;
  await deduplicationService.release(key);
}

function normalizeFingerprintText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function fingerprintHash(text: string): string {
  return createHash('sha256').update(normalizeFingerprintText(text)).digest('hex').slice(0, 16);
}

/**
 * Blocks duplicate customer processing during webhook retries or concurrent delivery.
 * deliver the same user text within a short window with different message IDs.
 */
export async function claimCustomerInboundFingerprint(
  companyId: string,
  phone: string,
  messageText: string,
  ttlSeconds = 90,
): Promise<boolean> {
  const phoneKey = phone.replace(/\D/g, '').slice(-10);
  if (!phoneKey || !messageText.trim()) return true;
  const key = `customer-fp:${companyId}:${phoneKey}:${fingerprintHash(messageText)}`;
  const claimed = await deduplicationService.claimMessageProcessing(key, ttlSeconds);
  if (!claimed) {
    logger.info('Customer inbound fingerprint dedup: duplicate blocked', {
      companyId,
      phoneKey,
    });
  }
  return claimed;
}

/**
 * Same as customer fingerprint but keyed by staff userId (dual-provider duplicate delivery).
 */
export async function claimStaffInboundFingerprint(
  companyId: string,
  userId: string,
  messageText: string,
  ttlSeconds = 90,
): Promise<boolean> {
  if (!userId || !messageText.trim()) return true;
  const key = `${STAFF_FINGERPRINT_PREFIX}${companyId}:${userId}:${fingerprintHash(messageText)}`;
  const claimed = await deduplicationService.claimMessageProcessing(key, ttlSeconds);
  if (!claimed) {
    logger.info('Staff inbound fingerprint dedup: duplicate blocked', {
      companyId,
      userId,
    });
  }
  return claimed;
}

/**
 * Ensures at most one outbound bundle (text + interactive + media) per inbound messageId.
 */
export async function claimOutboundTurn(
  companyId: string,
  inboundMessageId: string | undefined | null,
  ttlSeconds = 300,
): Promise<boolean> {
  if (!inboundMessageId?.trim()) return true;
  const key = `${OUTBOUND_TURN_PREFIX}${companyId}:${inboundMessageId.trim()}`;
  const claimed = await deduplicationService.claimMessageProcessing(key, ttlSeconds);
  if (!claimed) {
    logger.info('Outbound turn dedup: duplicate send blocked', {
      companyId,
      inboundMessageId,
    });
  }
  return claimed;
}

/**
 * Ensures at most one AI WhatsApp text reply per inbound messageId (buyers).
 */
export async function claimOutboundAiReply(
  companyId: string,
  inboundMessageId: string | undefined | null,
  ttlSeconds = 300,
): Promise<boolean> {
  return claimOutboundTurn(companyId, inboundMessageId, ttlSeconds);
}

/**
 * Ensures at most one copilot text reply per inbound messageId (staff).
 */
export async function claimStaffCopilotOutboundReply(
  companyId: string,
  inboundMessageId: string | undefined | null,
  ttlSeconds = 300,
): Promise<boolean> {
  if (!inboundMessageId?.trim()) return true;
  const key = `${OUTBOUND_COPILOT_PREFIX}${companyId}:${inboundMessageId.trim()}`;
  const claimed = await deduplicationService.claimMessageProcessing(key, ttlSeconds);
  if (!claimed) {
    logger.info('Staff copilot outbound dedup: duplicate send blocked', {
      companyId,
      inboundMessageId,
    });
  }
  return claimed;
}

/**
 * Belt-and-suspenders: one agent intent/action execution per inbound message.
 */
export async function claimAgentActionOnce(
  companyId: string,
  userId: string,
  inboundMessageId: string | undefined | null,
  actionKey: string,
  ttlSeconds = 120,
): Promise<boolean> {
  const scope = inboundMessageId?.trim();
  if (!scope) return true;
  const hash = createHash('sha256').update(actionKey).digest('hex').slice(0, 12);
  const key = `${AGENT_ACTION_PREFIX}${companyId}:${userId}:${scope}:${hash}`;
  const claimed = await deduplicationService.claimMessageProcessing(key, ttlSeconds);
  if (!claimed) {
    logger.info('Agent action dedup: duplicate execution blocked', {
      companyId,
      userId,
      actionKey,
    });
  }
  return claimed;
}
