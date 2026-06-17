import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';

function prismaClient(): any {
  return prisma as any;
}

const DEFAULT_TTL_MINUTES = 60;

export class ImpersonationService {
  isEnabled(): boolean {
    return config.features.supportOps === true;
  }

  async startImpersonation(input: {
    companyId: string;
    supportUserId: string;
    targetUserId: string;
    ticketId: string;
    ttlMinutes?: number;
  }) {
    if (!this.isEnabled()) {
      throw new Error('Support ops feature is disabled');
    }
    if (!input.ticketId?.trim()) {
      throw new Error('ticket_id is required for impersonation');
    }

    const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000);

    const session = await prismaClient().supportImpersonation.create({
      data: {
        companyId: input.companyId,
        supportUserId: input.supportUserId,
        targetUserId: input.targetUserId,
        ticketId: input.ticketId.trim(),
        expiresAt,
      },
    });

    await prismaClient().auditLog.create({
      data: {
        companyId: input.companyId,
        userId: input.supportUserId,
        action: 'support_impersonation_start',
        resourceType: 'user',
        resourceId: input.targetUserId,
        details: {
          ticket_id: input.ticketId,
          expires_at: expiresAt.toISOString(),
          impersonation_id: session.id,
        },
      },
    });

    logger.info('Support impersonation started', {
      companyId: input.companyId,
      supportUserId: input.supportUserId,
      targetUserId: input.targetUserId,
      ticketId: input.ticketId,
    });

    return session;
  }

  async revokeImpersonation(companyId: string, impersonationId: string, revokedBy: string) {
    const result = await prismaClient().supportImpersonation.updateMany({
      where: { id: impersonationId, companyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count > 0) {
      await prismaClient().auditLog.create({
        data: {
          companyId,
          userId: revokedBy,
          action: 'support_impersonation_revoke',
          resourceType: 'support_impersonation',
          resourceId: impersonationId,
          details: {},
        },
      });
    }

    return result;
  }

  async getActiveSession(supportUserId: string) {
    return prismaClient().supportImpersonation.findFirst({
      where: {
        supportUserId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const impersonationService = new ImpersonationService();
