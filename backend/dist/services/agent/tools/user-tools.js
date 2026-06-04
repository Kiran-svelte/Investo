"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserTools = createUserTools;
const crypto_1 = __importDefault(require("crypto"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const confirmation_service_1 = require("../confirmation.service");
const format_helpers_1 = require("./format-helpers");
const staffPhoneUniqueness_1 = require("../../../utils/staffPhoneUniqueness");
const userProfilePhone_1 = require("../../../utils/userProfilePhone");
const langchain_runtime_1 = require("./langchain-runtime");
function adminOnly(context) {
    return (0, format_helpers_1.isAdminRole)(context.userRole) ? null : 'Only admins can use this tool.';
}
function createUserTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listAgents',
            description: 'List company users. Admin only.',
            schema: zod_1.z.object({ status: zod_1.z.enum(['active', 'inactive']).optional(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ status, limit }) => {
                const denied = adminOnly(context);
                if (denied)
                    return denied;
                const users = await prisma_1.default.user.findMany({ where: { companyId: context.companyId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT });
                if (!users.length)
                    return 'No users found.';
                return ['*Team Members*', ...users.map((u, i) => `${i + 1}. ${u.name} - ${u.role} (${u.status})\n   ${u.email} | ${(0, format_helpers_1.maskPhone)(u.phone)}\n   ID: ${u.id}`)].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'createAgent',
            description: 'Create a company user with a temporary password. Admin only.',
            schema: zod_1.z.object({ name: zod_1.z.string().min(1), email: zod_1.z.string().email(), phone: zod_1.z.string().min(8), role: zod_1.z.enum(['company_admin', 'sales_agent', 'operations', 'viewer']).default('sales_agent') }),
            func: async ({ name, email, phone, role }) => {
                const denied = adminOnly(context);
                if (denied)
                    return denied;
                const tempPassword = crypto_1.default.randomBytes(12).toString('hex');
                const passwordHash = await bcrypt_1.default.hash(tempPassword, agent_tools_constants_1.BCRYPT_SALT_ROUNDS);
                const user = await prisma_1.default.user.create({ data: { companyId: context.companyId, name, email: email.toLowerCase(), phone, role, status: 'active', passwordHash, mustChangePassword: true } });
                return `User created: ${user.name} (${user.role}). Temporary password generated; use normal onboarding/reset flow to share credentials.`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'updateAgent',
            description: 'Update company user fields. Admin only.',
            schema: zod_1.z.object({ agentId: zod_1.z.string().uuid(), name: zod_1.z.string().optional(), phone: zod_1.z.string().optional(), role: zod_1.z.enum(['company_admin', 'sales_agent', 'operations', 'viewer']).optional(), status: zod_1.z.enum(['active', 'inactive']).optional() }),
            func: async ({ agentId, ...fields }) => {
                const denied = adminOnly(context);
                if (denied)
                    return denied;
                const user = await prisma_1.default.user.findFirst({ where: { id: agentId, companyId: context.companyId } });
                if (!user)
                    return 'User not found.';
                const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
                if (!Object.keys(data).length)
                    return 'No fields provided.';
                try {
                    if (typeof data.phone === 'string') {
                        const normalized = (0, userProfilePhone_1.normalizeStaffProfilePhone)(data.phone);
                        if (!normalized)
                            return 'Invalid phone number.';
                        await (0, staffPhoneUniqueness_1.assertStaffPhoneAvailable)(normalized, agentId);
                        data.phone = normalized;
                    }
                    await prisma_1.default.user.update({ where: { id: agentId }, data });
                    return `Updated ${user.name}: ${Object.keys(data).join(', ')}`;
                }
                catch (err) {
                    if ((0, staffPhoneUniqueness_1.isStaffPhoneInUseError)(err))
                        return err.message;
                    throw err;
                }
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'deactivateAgent',
            description: 'Deactivate a user. Requires yes/no confirmation. Admin only.',
            schema: zod_1.z.object({ agentId: zod_1.z.string().uuid() }),
            func: async ({ agentId }) => {
                const denied = adminOnly(context);
                if (denied)
                    return denied;
                if (!context.sessionId)
                    return 'Confirmation session unavailable.';
                const user = await prisma_1.default.user.findFirst({ where: { id: agentId, companyId: context.companyId, status: 'active' } });
                if (!user)
                    return 'User not found or already inactive.';
                const message = `Confirm deactivation of ${user.name} (${user.role})?\nReply "yes" to confirm or "no" to cancel.`;
                await (0, confirmation_service_1.createPendingConfirmation)(context.sessionId, 'deactivateAgent', { agentId }, message);
                return message;
            },
        }),
    ];
}
