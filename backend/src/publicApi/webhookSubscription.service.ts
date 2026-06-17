import crypto from 'crypto';
import bcrypt from 'bcrypt';
import axios from 'axios';

import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';

function prismaClient(): any {
  return prisma as any;
}

export class WebhookSubscriptionService {
  isEnabled(): boolean {
    return config.features.publicApi === true;
  }

  generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  signPayload(secret: string, body: string, timestamp: number): string {
    const payload = `${timestamp}.${body}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  async createSubscription(input: {
    companyId: string;
    url: string;
    events: string[];
  }) {
    if (!this.isEnabled()) {
      throw new Error('Public API feature is disabled');
    }

    const secret = this.generateSecret();
    const secretHash = await bcrypt.hash(secret, 10);

    const row = await prismaClient().webhookSubscription.create({
      data: {
        companyId: input.companyId,
        url: input.url,
        secretHash,
        events: input.events,
        active: true,
      },
    });

    return { subscription: row, secret };
  }

  async listActive(companyId: string, eventType?: string) {
    const rows = await prismaClient().webhookSubscription.findMany({
      where: { companyId, active: true },
    });
    if (!eventType) return rows;
    return rows.filter((row: any) => {
      const events = (row.events as string[]) || [];
      return events.includes(eventType) || events.includes('*');
    });
  }

  async dispatch(companyId: string, eventType: string, payload: unknown, secretPlain?: string): Promise<void> {
    if (!this.isEnabled()) return;

    const subs = await this.listActive(companyId, eventType);
    const body = JSON.stringify({ event: eventType, data: payload, emitted_at: new Date().toISOString() });
    const timestamp = Math.floor(Date.now() / 1000);

    for (const sub of subs) {
      try {
        const secret = secretPlain || process.env.PUBLIC_WEBHOOK_DEV_SECRET || 'dev-secret';
        const signature = this.signPayload(secret, body, timestamp);
        await axios.post(sub.url, body, {
          headers: {
            'Content-Type': 'application/json',
            'X-Investo-Signature': signature,
            'X-Investo-Timestamp': String(timestamp),
            'X-Investo-Event': eventType,
          },
          timeout: 10_000,
          validateStatus: () => true,
        });
      } catch (err) {
        logger.warn('Public webhook dispatch failed', {
          companyId,
          eventType,
          url: sub.url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

export const webhookSubscriptionService = new WebhookSubscriptionService();
