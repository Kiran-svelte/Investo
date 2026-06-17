import { Prisma } from '@prisma/client';

import config from '../../config';
import prisma from '../../config/prisma';
import type { WhatsAppInboundQueuePayload } from './whatsappInboundQueue.service';

function prismaClient(): any {
  return prisma as any;
}

export class DeadLetterService {
  async listWhatsAppDeadLetters(limit = 50): Promise<any[]> {
    return prismaClient().whatsAppDeadLetter.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async replayWhatsAppDeadLetter(id: string): Promise<{ jobId: string; idempotencyKey: string }> {
    const deadLetter = await prismaClient().whatsAppDeadLetter.findUnique({ where: { id } });
    if (!deadLetter) {
      const err = new Error('Dead-letter job not found');
      (err as any).statusCode = 404;
      throw err;
    }

    const idempotencyKey = `replay:${deadLetter.jobId}:${Date.now()}`;
    const job = await prismaClient().whatsAppJob.create({
      data: {
        companyId: deadLetter.companyId,
        jobType: 'inbound_turn',
        idempotencyKey,
        payload: deadLetter.payload as WhatsAppInboundQueuePayload as unknown as Prisma.InputJsonValue,
        status: 'pending',
        attempts: 0,
        maxAttempts: config.whatsappQueue.inboundMaxAttempts,
      },
    });

    return { jobId: job.id, idempotencyKey };
  }
}

export const deadLetterService = new DeadLetterService();
