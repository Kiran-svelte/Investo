import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import prisma from '../../../config/prisma';
import { DEFAULT_NOTIFICATION_LIMIT, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { formatDateIST, isAdminRole, truncate } from './format-helpers';

function scope(context: ToolContext): any {
  return isAdminRole(context.userRole) ? { companyId: context.companyId } : { userId: context.userId };
}

export function createNotificationTools(context: ToolContext): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'listNotifications',
      description: 'List notifications for the caller or company admins.',
      schema: z.object({ unreadOnly: z.boolean().default(true), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ unreadOnly, limit }) => {
        const rows = await prisma.notification.findMany({ where: { ...scope(context), ...(unreadOnly ? { read: false } : {}) }, orderBy: { createdAt: 'desc' }, take: limit ?? DEFAULT_NOTIFICATION_LIMIT });
        if (!rows.length) return 'No notifications found.';
        return ['*Notifications*', ...rows.map((n, i) => `${i + 1}. ${n.title ?? n.type}\n   ${truncate(n.message ?? '', 160)}\n   ${formatDateIST(n.createdAt)} | ID: ${n.id}`)].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'markNotificationsRead',
      description: 'Mark notifications read. Empty list marks all scoped unread notifications read.',
      schema: z.object({ notificationIds: z.array(z.string().uuid()).optional() }),
      func: async ({ notificationIds }) => {
        const result = await prisma.notification.updateMany({ where: { ...scope(context), read: false, ...(notificationIds?.length ? { id: { in: notificationIds } } : {}) }, data: { read: true } });
        return `Marked ${result.count} notification(s) read.`;
      },
    }),
  ];
}
