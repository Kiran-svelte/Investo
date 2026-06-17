import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import config from '../../config';
import logger from '../../config/logger';
import prisma from '../../config/prisma';

export type WhatsAppJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dlq';
export type WhatsAppJobType = 'inbound_turn';

export interface WhatsAppInboundQueuePayload {
  webhookBody: unknown;
  messageIds: string[];
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  queuedAt: string;
}

export interface WhatsAppQueueJob {
  id: string;
  companyId: string;
  jobType: WhatsAppJobType;
  idempotencyKey: string;
  payload: WhatsAppInboundQueuePayload;
  status: WhatsAppJobStatus;
  attempts: number;
  maxAttempts: number;
}

export interface WebhookCompanyResolverInput {
  phoneNumberId: string | null;
  customerPhoneE164: string | null;
  displayPhoneNumber: string | null;
}

export type WebhookCompanyResolver = (
  input: WebhookCompanyResolverInput,
) => Promise<{ company?: { id?: string | null } | null; companyId?: string | null; id?: string | null } | null>;

export interface EnqueueWebhookResult {
  status: 'enqueued' | 'duplicate' | 'skipped';
  reason?: string;
  jobId?: string;
  idempotencyKey?: string;
  companyId?: string;
  messageIds: string[];
}

const INBOUND_JOB_TYPE: WhatsAppJobType = 'inbound_turn';

function prismaClient(): any {
  return prisma as any;
}

function normalizePrismaJob(row: any): WhatsAppQueueJob {
  return {
    id: row.id,
    companyId: row.companyId,
    jobType: row.jobType,
    idempotencyKey: row.idempotencyKey,
    payload: row.payload as WhatsAppInboundQueuePayload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
  };
}

function buildRetryAt(attempt: number): Date {
  const delayMs = Math.min(60_000, Math.pow(2, attempt) * 2_000);
  return new Date(Date.now() + delayMs);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractWebhookEnvelope(body: any): {
  messageIds: string[];
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  firstCustomerPhoneE164: string | null;
} {
  const messageIds: string[] = [];
  let phoneNumberId: string | null = null;
  let displayPhoneNumber: string | null = null;
  let firstCustomerPhoneE164: string | null = null;

  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      if (change?.field !== 'messages') continue;
      const value = change.value || {};
      phoneNumberId ||= typeof value.metadata?.phone_number_id === 'string'
        ? value.metadata.phone_number_id
        : null;
      displayPhoneNumber ||= typeof value.metadata?.display_phone_number === 'string'
        ? value.metadata.display_phone_number
        : null;

      for (const message of value.messages || []) {
        if (message?.id) {
          messageIds.push(String(message.id));
        }
        if (!firstCustomerPhoneE164 && message?.from) {
          firstCustomerPhoneE164 = `+${message.from}`;
        }
      }
    }
  }

  return { messageIds, phoneNumberId, displayPhoneNumber, firstCustomerPhoneE164 };
}

function buildIdempotencyKey(body: unknown, messageIds: string[]): string {
  const hash = crypto
    .createHash('sha256')
    .update(messageIds.length ? messageIds.sort().join('|') : JSON.stringify(body))
    .digest('hex');
  return `meta:webhook:${hash}`;
}

function resolveCompanyId(resolution: Awaited<ReturnType<WebhookCompanyResolver>>): string {
  return (
    resolution?.company?.id
    || resolution?.companyId
    || resolution?.id
    || ''
  );
}

export class WhatsAppInboundQueueService {
  async enqueueWebhookPayload(
    webhookBody: unknown,
    resolveCompany: WebhookCompanyResolver,
  ): Promise<EnqueueWebhookResult> {
    const envelope = extractWebhookEnvelope(webhookBody);
    if (envelope.messageIds.length === 0) {
      return { status: 'skipped', reason: 'no_messages', messageIds: [] };
    }

    const companyResolution = await resolveCompany({
      phoneNumberId: envelope.phoneNumberId,
      customerPhoneE164: envelope.firstCustomerPhoneE164,
      displayPhoneNumber: envelope.displayPhoneNumber,
    });
    const companyId = resolveCompanyId(companyResolution);
    if (!companyId) {
      return {
        status: 'skipped',
        reason: 'company_not_found',
        messageIds: envelope.messageIds,
      };
    }

    return this.enqueueInboundJob({
      companyId,
      idempotencyKey: buildIdempotencyKey(webhookBody, envelope.messageIds),
      payload: {
        webhookBody,
        messageIds: envelope.messageIds,
        phoneNumberId: envelope.phoneNumberId,
        displayPhoneNumber: envelope.displayPhoneNumber,
        queuedAt: new Date().toISOString(),
      },
    });
  }

  async enqueueInboundJob(params: {
    companyId: string;
    idempotencyKey: string;
    payload: WhatsAppInboundQueuePayload;
  }): Promise<EnqueueWebhookResult> {
    try {
      const row = await prismaClient().whatsAppJob.create({
        data: {
          companyId: params.companyId,
          jobType: INBOUND_JOB_TYPE,
          idempotencyKey: params.idempotencyKey,
          payload: params.payload as unknown as Prisma.InputJsonValue,
          status: 'pending',
          attempts: 0,
          maxAttempts: config.whatsappQueue.inboundMaxAttempts,
        },
      });

      logger.info('WhatsApp inbound queue transition', {
        queue: 'whatsapp_inbound',
        transition: 'queued',
        jobId: row.id,
        companyId: params.companyId,
        idempotencyKey: params.idempotencyKey,
        messageCount: params.payload.messageIds.length,
      });

      return {
        status: 'enqueued',
        jobId: row.id,
        companyId: params.companyId,
        idempotencyKey: params.idempotencyKey,
        messageIds: params.payload.messageIds,
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return {
          status: 'duplicate',
          companyId: params.companyId,
          idempotencyKey: params.idempotencyKey,
          messageIds: params.payload.messageIds,
        };
      }
      throw err;
    }
  }

  async processDueJobs(
    processor: (job: WhatsAppQueueJob) => Promise<void>,
    batchSize = config.whatsappQueue.inboundWorkerBatchSize,
  ): Promise<number> {
    const now = new Date();
    const rows = await prismaClient().whatsAppJob.findMany({
      where: {
        jobType: INBOUND_JOB_TYPE,
        status: { in: ['pending', 'failed'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    let processed = 0;

    for (const row of rows) {
      const claimed = await prismaClient().whatsAppJob.updateMany({
        where: {
          id: row.id,
          status: { in: ['pending', 'failed'] },
        },
        data: {
          status: 'processing',
          lastError: null,
        },
      });

      if (claimed.count !== 1) continue;

      const job = normalizePrismaJob({ ...row, status: 'processing' });
      try {
        await processor(job);
        await prismaClient().whatsAppJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            processedAt: new Date(),
            lastError: null,
          },
        });
        processed += 1;
      } catch (err) {
        await this.handleFailure(job, err);
      }
    }

    return processed;
  }

  async clearAll(): Promise<void> {
    await prismaClient().whatsAppDeadLetter.deleteMany({});
    await prismaClient().whatsAppJob.deleteMany({});
  }

  private async handleFailure(job: WhatsAppQueueJob, err: unknown): Promise<void> {
    const attempts = job.attempts + 1;
    const message = errorMessage(err);

    if (attempts >= job.maxAttempts) {
      await prismaClient().$transaction([
        prismaClient().whatsAppDeadLetter.create({
          data: {
            jobId: job.id,
            companyId: job.companyId,
            payload: job.payload as unknown as Prisma.InputJsonValue,
            error: message,
          },
        }),
        prismaClient().whatsAppJob.update({
          where: { id: job.id },
          data: {
            status: 'dlq',
            attempts,
            lastError: message,
            processedAt: new Date(),
          },
        }),
      ]);
      return;
    }

    await prismaClient().whatsAppJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        attempts,
        lastError: message,
        nextAttemptAt: buildRetryAt(attempts),
      },
    });
  }
}

export const whatsappInboundQueueService = new WhatsAppInboundQueueService();
