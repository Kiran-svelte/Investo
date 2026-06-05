import { deduplicationService } from './deduplication.service';
import logger from '../config/logger';

const INBOUND_KEY_PREFIX = 'inbound:';
const STAFF_PROCESSING_PREFIX = 'staff-processing:';

/** TTL for in-flight staff copilot lock (prevents parallel duplicate replies). */
const STAFF_PROCESSING_TTL_SECONDS = 45;

/**
 * Unified inbound dedup key — shared by Meta/GreenAPI webhooks and handleIncomingMessage.
 */
export function buildInboundDedupKey(companyId: string, messageId: string): string {
  return `${INBOUND_KEY_PREFIX}${companyId}:${messageId}`;
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

export async function releaseInboundMessage(
  companyId: string,
  messageId: string | undefined | null,
): Promise<void> {
  if (!messageId?.trim()) return;
  await deduplicationService.release(buildInboundDedupKey(companyId, messageId.trim()));
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
