import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { webhookSubscriptionService } from '../publicApi/webhookSubscription.service';

function prismaClient(): any {
  return prisma as any;
}

export class OutboxService {
  isEnabled(): boolean {
    return config.features.outboxEvents === true;
  }

  async publish(input: {
    companyId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) {
    if (!this.isEnabled()) {
      throw new Error('Outbox events feature is disabled');
    }

    const event = await prismaClient().outboxEvent.create({
      data: {
        companyId: input.companyId,
        eventType: input.eventType,
        payload: input.payload,
        status: 'pending',
      },
    });

    return event;
  }

  async processPending(limit = 50): Promise<number> {
    if (!this.isEnabled()) return 0;

    const pending = await prismaClient().outboxEvent.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let processed = 0;
    for (const event of pending) {
      try {
        await webhookSubscriptionService.dispatch(event.companyId, event.eventType, event.payload);
        await prismaClient().outboxEvent.update({
          where: { id: event.id },
          data: { status: 'published', publishedAt: new Date() },
        });
        processed += 1;
      } catch (err) {
        logger.warn('Outbox publish failed', {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return processed;
  }

  async listEvents(companyId: string, status?: string) {
    return prismaClient().outboxEvent.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

export const outboxService = new OutboxService();
