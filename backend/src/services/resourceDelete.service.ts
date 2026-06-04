import prisma from '../config/prisma';
import { deletePropertyKnowledge } from './propertyKnowledge.service';
import logger from '../config/logger';

export class ResourceDeleteError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ResourceDeleteError';
  }
}

/** Permanently delete a lead and its conversations, messages, and visits. */
export async function deleteLeadPermanently(companyId: string, leadId: string): Promise<void> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId } });
  if (!lead) {
    throw new ResourceDeleteError('Lead not found', 404);
  }

  const conversations = await prisma.conversation.findMany({
    where: { companyId, leadId },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.conversation.deleteMany({ where: { companyId, leadId } }),
    prisma.visit.deleteMany({ where: { companyId, leadId } }),
    prisma.lead.delete({ where: { id: leadId } }),
  ]);
}

/** Permanently delete a conversation and all messages. */
export async function deleteConversationPermanently(
  companyId: string,
  conversationId: string,
): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, companyId },
  });
  if (!conversation) {
    throw new ResourceDeleteError('Conversation not found', 404);
  }

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId } }),
    prisma.conversation.delete({ where: { id: conversationId } }),
  ]);
}

/** Permanently delete a visit. */
export async function deleteVisitPermanently(companyId: string, visitId: string): Promise<void> {
  const visit = await prisma.visit.findFirst({ where: { id: visitId, companyId } });
  if (!visit) {
    throw new ResourceDeleteError('Visit not found', 404);
  }
  await prisma.visit.delete({ where: { id: visitId } });
}

/** Delete a notification visible to the user (own or company-wide). */
export async function deleteNotificationPermanently(
  companyId: string,
  userId: string,
  notificationId: string,
): Promise<void> {
  const row = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      companyId,
      OR: [{ userId }, { userId: null }],
    },
  });
  if (!row) {
    throw new ResourceDeleteError('Notification not found', 404);
  }
  await prisma.notification.delete({ where: { id: notificationId } });
}

/** Delete all notifications for the current user in the company. */
export async function deleteAllNotificationsForUser(
  companyId: string,
  userId: string,
): Promise<number> {
  const result = await prisma.notification.deleteMany({
    where: {
      companyId,
      OR: [{ userId }, { userId: null }],
    },
  });
  return result.count;
}

/** Hard-delete a team user (not self). Unassigns leads; removes their visits as agent. */
export async function deleteUserPermanently(
  companyId: string,
  targetUserId: string,
  actorUserId: string,
): Promise<void> {
  if (targetUserId === actorUserId) {
    throw new ResourceDeleteError('Cannot delete your own account', 400);
  }

  const user = await prisma.user.findFirst({ where: { id: targetUserId, companyId } });
  if (!user) {
    throw new ResourceDeleteError('User not found', 404);
  }

  if (user.role === 'super_admin') {
    throw new ResourceDeleteError('Cannot delete super admin accounts', 403);
  }

  await prisma.$transaction([
    prisma.lead.updateMany({
      where: { companyId, assignedAgentId: targetUserId },
      data: { assignedAgentId: null },
    }),
    prisma.visit.deleteMany({ where: { companyId, agentId: targetUserId } }),
    prisma.notification.deleteMany({ where: { userId: targetUserId } }),
    prisma.agentActionLog.deleteMany({ where: { actorId: targetUserId } }),
    prisma.agentSession.deleteMany({ where: { userId: targetUserId } }),
    prisma.refreshToken.deleteMany({ where: { userId: targetUserId } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: targetUserId } }),
    prisma.user.delete({ where: { id: targetUserId } }),
  ]);
}

/** Super admin: permanently delete a company and all tenant data. */
export async function deleteCompanyPermanently(companyId: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    throw new ResourceDeleteError('Company not found', 404);
  }

  const properties = await prisma.property.findMany({
    where: { companyId },
    select: { id: true },
  });

  for (const property of properties) {
    try {
      await deletePropertyKnowledge(property.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Property knowledge delete failed during company purge', {
        propertyId: property.id,
        error: message,
      });
    }
  }

  const conversationIds = (
    await prisma.conversation.findMany({ where: { companyId }, select: { id: true } })
  ).map((c) => c.id);

  const userIds = (
    await prisma.user.findMany({ where: { companyId }, select: { id: true } })
  ).map((u) => u.id);

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.agentActionLog.deleteMany({ where: { companyId } }),
    prisma.notification.deleteMany({ where: { companyId } }),
    prisma.visit.deleteMany({ where: { companyId } }),
    prisma.conversation.deleteMany({ where: { companyId } }),
    prisma.lead.deleteMany({ where: { companyId } }),
    prisma.property.deleteMany({ where: { companyId } }),
    prisma.propertyImportDraft.deleteMany({ where: { companyId } }),
    prisma.propertyProject.deleteMany({ where: { companyId } }),
    prisma.auditLog.deleteMany({ where: { companyId } }),
    prisma.analytics.deleteMany({ where: { companyId } }),
    prisma.invoice.deleteMany({ where: { companyId } }),
    prisma.companyFeature.deleteMany({ where: { companyId } }),
    prisma.companyOnboarding.deleteMany({ where: { companyId } }),
    prisma.companyRole.deleteMany({ where: { companyId } }),
    prisma.aiSetting.deleteMany({ where: { companyId } }),
    prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { companyId } }),
    prisma.company.delete({ where: { id: companyId } }),
  ]);
}

/** Remove import draft and all cascaded media/units/jobs from DB. */
export async function purgePropertyImportDraft(
  companyId: string,
  draftId: string,
): Promise<void> {
  const draft = await prisma.propertyImportDraft.findFirst({
    where: { id: draftId, companyId },
    select: { id: true, status: true, publishedPropertyId: true },
  });

  if (!draft) {
    throw new ResourceDeleteError('Draft not found', 404);
  }

  if (draft.status === 'published' && draft.publishedPropertyId) {
    throw new ResourceDeleteError(
      'Published import cannot be purged. Delete the published property instead.',
      409,
    );
  }

  await prisma.propertyImportDraft.delete({ where: { id: draftId } });
}

/** Delete a file attached to a property project. */
export async function deletePropertyProjectFile(
  companyId: string,
  projectId: string,
  fileId: string,
): Promise<void> {
  const file = await prisma.propertyProjectFile.findFirst({
    where: { id: fileId, projectId, companyId },
  });
  if (!file) {
    throw new ResourceDeleteError('Project file not found', 404);
  }
  await prisma.propertyProjectFile.delete({ where: { id: fileId } });
}
