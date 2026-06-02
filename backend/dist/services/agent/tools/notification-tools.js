"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotificationTools = createNotificationTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
function scope(context) {
    return (0, format_helpers_1.isAdminRole)(context.userRole) ? { companyId: context.companyId } : { userId: context.userId };
}
function createNotificationTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listNotifications',
            description: 'List notifications for the caller or company admins.',
            schema: zod_1.z.object({ unreadOnly: zod_1.z.boolean().default(true), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ unreadOnly, limit }) => {
                const rows = await prisma_1.default.notification.findMany({ where: { ...scope(context), ...(unreadOnly ? { read: false } : {}) }, orderBy: { createdAt: 'desc' }, take: limit ?? agent_tools_constants_1.DEFAULT_NOTIFICATION_LIMIT });
                if (!rows.length)
                    return 'No notifications found.';
                return ['*Notifications*', ...rows.map((n, i) => `${i + 1}. ${n.title ?? n.type}\n   ${(0, format_helpers_1.truncate)(n.message ?? '', 160)}\n   ${(0, format_helpers_1.formatDateIST)(n.createdAt)} | ID: ${n.id}`)].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'markNotificationsRead',
            description: 'Mark notifications read. Empty list marks all scoped unread notifications read.',
            schema: zod_1.z.object({ notificationIds: zod_1.z.array(zod_1.z.string().uuid()).optional() }),
            func: async ({ notificationIds }) => {
                const result = await prisma_1.default.notification.updateMany({ where: { ...scope(context), read: false, ...(notificationIds?.length ? { id: { in: notificationIds } } : {}) }, data: { read: true } });
                return `Marked ${result.count} notification(s) read.`;
            },
        }),
    ];
}
