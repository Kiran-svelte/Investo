import prisma from '../config/prisma';
import logger from '../config/logger';

function prismaClient(): any {
  return prisma as any;
}

export async function revokeAllUserSessions(userId: string, reason: string): Promise<number> {
  const result = await prismaClient().refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true },
  });

  logger.info('User sessions revoked', { userId, reason, count: result.count });
  return result.count;
}

export async function deactivateScimUser(params: {
  companyId: string;
  externalId: string;
}): Promise<{ userId: string | null; sessionsRevoked: number }> {
  const user = await prismaClient().user.findFirst({
    where: {
      companyId: params.companyId,
      externalId: params.externalId,
    },
  });

  if (!user) {
    return { userId: null, sessionsRevoked: 0 };
  }

  await prismaClient().user.update({
    where: { id: user.id },
    data: { status: 'inactive' },
  });

  const sessionsRevoked = await revokeAllUserSessions(user.id, 'scim_deactivate');

  await prismaClient().scimProvisioningEvent.create({
    data: {
      companyId: params.companyId,
      action: 'scim_user_deactivated',
      externalId: params.externalId,
      userId: user.id,
      payload: { status: 'inactive' },
    },
  });

  await prismaClient().auditLog.create({
    data: {
      companyId: params.companyId,
      userId: null,
      action: 'scim_user_deactivated',
      resourceType: 'user',
      resourceId: user.id,
      details: { external_id: params.externalId },
    },
  });

  return { userId: user.id, sessionsRevoked };
}
