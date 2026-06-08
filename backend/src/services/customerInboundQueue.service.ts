import { getRedis } from '../config/redis';
import logger from '../config/logger';

/** Payload replayed from the per-phone FIFO when the processing lock frees. */
export type QueuedCustomerInbound = {
  phoneNumberId: string;
  customerPhone: string;
  customerName: string;
  messageText: string;
  messageId: string;
  companyIdHint?: string;
  interactiveId?: string;
  interactiveType?: 'button_reply' | 'list_reply';
  businessDisplayPhone?: string;
};

const QUEUE_PREFIX = 'customer-inbound-queue:';
const QUEUE_TTL_SECONDS = 3600;

const memQueues = new Map<string, QueuedCustomerInbound[]>();

function buildQueueKey(companyId: string, phone: string): string {
  const phoneKey = phone.replace(/\D/g, '').slice(-10);
  return `${QUEUE_PREFIX}${companyId}:${phoneKey}`;
}

export async function enqueueCustomerInbound(
  companyId: string,
  customerPhone: string,
  payload: QueuedCustomerInbound,
): Promise<void> {
  const key = buildQueueKey(companyId, customerPhone);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.rpush(key, JSON.stringify(payload));
      await redis.expire(key, QUEUE_TTL_SECONDS);
      logger.debug('Customer inbound enqueued (Redis)', { companyId, messageId: payload.messageId });
      return;
    } catch (err: unknown) {
      logger.warn('Redis customer inbound enqueue failed — in-memory fallback', {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const queue = memQueues.get(key) ?? [];
  queue.push(payload);
  memQueues.set(key, queue);
}

export async function dequeueCustomerInbound(
  companyId: string,
  customerPhone: string,
): Promise<QueuedCustomerInbound | null> {
  const key = buildQueueKey(companyId, customerPhone);
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.lpop<string>(key);
      if (!raw) return null;
      return typeof raw === 'string' ? (JSON.parse(raw) as QueuedCustomerInbound) : raw;
    } catch (err: unknown) {
      logger.warn('Redis customer inbound dequeue failed — in-memory fallback', {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const queue = memQueues.get(key);
  if (!queue?.length) return null;
  const item = queue.shift()!;
  if (queue.length === 0) memQueues.delete(key);
  return item;
}

/**
 * Process the next queued inbound for this phone when the turn lock is free.
 * Nested calls chain via each turn's finally block until the queue is empty.
 */
export async function drainCustomerInboundQueue(
  companyId: string,
  customerPhone: string,
): Promise<void> {
  const next = await dequeueCustomerInbound(companyId, customerPhone);
  if (!next) return;

  const { whatsappService } = await import('./whatsapp.service');
  try {
    await whatsappService.handleIncomingMessage({
      phoneNumberId: next.phoneNumberId,
      customerPhone: next.customerPhone,
      customerName: next.customerName,
      messageText: next.messageText,
      messageId: next.messageId,
      companyIdHint: next.companyIdHint ?? companyId,
      interactiveId: next.interactiveId,
      interactiveType: next.interactiveType,
      businessDisplayPhone: next.businessDisplayPhone,
      queuedReplay: true,
    });
  } catch (err: unknown) {
    logger.error('Drained customer inbound message failed', {
      companyId,
      messageId: next.messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      const { automationQueueService } = await import('./automationQueue.service');
      await automationQueueService.schedule(
        'retry_concurrent_inbound',
        `concurrent:${companyId}:${next.messageId}`,
        new Date(Date.now() + 5_000),
        { companyId, ...next, queuedReplay: true },
      );
    } catch (queueErr: unknown) {
      logger.warn('Failed to schedule short retry for drained inbound', {
        companyId,
        messageId: next.messageId,
        error: queueErr instanceof Error ? queueErr.message : String(queueErr),
      });
    }
  }
}

/** Test-only reset for in-memory fallback queues. */
export function _resetCustomerInboundQueuesForTests(): void {
  memQueues.clear();
}
