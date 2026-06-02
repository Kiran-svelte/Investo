import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../../../config/prisma';
import { BCRYPT_SALT_ROUNDS, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { createPendingConfirmation } from '../confirmation.service';
import { isAdminRole, maskPhone } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

function adminOnly(context: ToolContext): string | null {
  return isAdminRole(context.userRole) ? null : 'Only admins can use this tool.';
}

export function createUserTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'listAgents',
      description: 'List company users. Admin only.',
      schema: z.object({ status: z.enum(['active', 'inactive']).optional(), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ status, limit }) => {
        const denied = adminOnly(context); if (denied) return denied;
        const users = await prisma.user.findMany({ where: { companyId: context.companyId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: limit ?? DEFAULT_LIST_LIMIT });
        if (!users.length) return 'No users found.';
        return ['*Team Members*', ...users.map((u, i) => `${i + 1}. ${u.name} - ${u.role} (${u.status})\n   ${u.email} | ${maskPhone(u.phone)}\n   ID: ${u.id}`)].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'createAgent',
      description: 'Create a company user with a temporary password. Admin only.',
      schema: z.object({ name: z.string().min(1), email: z.string().email(), phone: z.string().min(8), role: z.enum(['company_admin', 'sales_agent', 'operations', 'viewer']).default('sales_agent') }),
      func: async ({ name, email, phone, role }) => {
        const denied = adminOnly(context); if (denied) return denied;
        const tempPassword = crypto.randomBytes(12).toString('hex');
        const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_SALT_ROUNDS);
        const user = await prisma.user.create({ data: { companyId: context.companyId, name, email: email.toLowerCase(), phone, role, status: 'active', passwordHash, mustChangePassword: true } });
        return `User created: ${user.name} (${user.role}). Temporary password generated; use normal onboarding/reset flow to share credentials.`;
      },
    }),
    new DynamicStructuredTool({
      name: 'updateAgent',
      description: 'Update company user fields. Admin only.',
      schema: z.object({ agentId: z.string().uuid(), name: z.string().optional(), phone: z.string().optional(), role: z.enum(['company_admin', 'sales_agent', 'operations', 'viewer']).optional(), status: z.enum(['active', 'inactive']).optional() }),
      func: async ({ agentId, ...fields }) => {
        const denied = adminOnly(context); if (denied) return denied;
        const user = await prisma.user.findFirst({ where: { id: agentId, companyId: context.companyId } });
        if (!user) return 'User not found.';
        const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        if (!Object.keys(data).length) return 'No fields provided.';
        await prisma.user.update({ where: { id: agentId }, data });
        return `Updated ${user.name}: ${Object.keys(data).join(', ')}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'deactivateAgent',
      description: 'Deactivate a user. Requires yes/no confirmation. Admin only.',
      schema: z.object({ agentId: z.string().uuid() }),
      func: async ({ agentId }) => {
        const denied = adminOnly(context); if (denied) return denied;
        if (!context.sessionId) return 'Confirmation session unavailable.';
        const user = await prisma.user.findFirst({ where: { id: agentId, companyId: context.companyId, status: 'active' } });
        if (!user) return 'User not found or already inactive.';
        const message = `Confirm deactivation of ${user.name} (${user.role})?\nReply "yes" to confirm or "no" to cancel.`;
        await createPendingConfirmation(context.sessionId, 'deactivateAgent', { agentId }, message);
        return message;
      },
    }),
  ];
}
