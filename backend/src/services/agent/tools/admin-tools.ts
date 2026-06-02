import { z } from 'zod';
import prisma from '../../../config/prisma';
import { DEFAULT_AUDIT_LOG_LIMIT, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { formatDateIST, isAdminRole, truncate } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

function adminOnly(context: ToolContext): string | null {
  return isAdminRole(context.userRole) ? null : 'Only admins can use this tool.';
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createAdminTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'getCompanySettings',
      description: 'Show company settings. Admin only.',
      schema: z.object({}),
      func: async () => {
        const denied = adminOnly(context); if (denied) return denied;
        const company = await prisma.company.findUnique({ where: { id: context.companyId } });
        if (!company) return 'Company not found.';
        return [`*Company Settings*`, `Name: ${company.name}`, `Slug: ${company.slug}`, `Status: ${company.status}`, `WhatsApp: ${company.whatsappPhone ?? 'not set'}`, `Settings: ${truncate(JSON.stringify(company.settings ?? {}), 1200)}`].join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'updateCompanySettings',
      description: 'Merge fields into company settings JSON. Admin only.',
      schema: z.object({ fields: z.record(z.unknown()) }),
      func: async ({ fields }) => {
        const denied = adminOnly(context); if (denied) return denied;
        const company = await prisma.company.findUnique({ where: { id: context.companyId }, select: { settings: true } });
        if (!company) return 'Company not found.';
        await prisma.company.update({ where: { id: context.companyId }, data: { settings: { ...objectValue(company.settings), ...fields } as any } });
        return `Company settings updated: ${Object.keys(fields).join(', ')}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'getReadinessScore',
      description: 'Get go-live readiness checklist. Admin only.',
      schema: z.object({}),
      func: async () => {
        const denied = adminOnly(context); if (denied) return denied;
        const [agents, properties, aiSettings, company, leads] = await Promise.all([
          prisma.user.count({ where: { companyId: context.companyId, role: 'sales_agent', status: 'active' } }),
          prisma.property.count({ where: { companyId: context.companyId, status: 'available' } }),
          prisma.aiSetting.findUnique({ where: { companyId: context.companyId } }),
          prisma.company.findUnique({ where: { id: context.companyId } }),
          prisma.lead.count({ where: { companyId: context.companyId } }),
        ]);
        const checks = [
          ['Active agents', agents > 0, agents],
          ['Available properties', properties > 0, properties],
          ['AI settings', !!aiSettings, aiSettings ? 'yes' : 'no'],
          ['WhatsApp phone', !!company?.whatsappPhone, company?.whatsappPhone ?? 'not set'],
          ['Lead pipeline', leads > 0, leads],
        ] as const;
        const score = Math.round((checks.filter(([, pass]) => pass).length / checks.length) * 100);
        return [`*Readiness Score: ${score}%*`, ...checks.map(([label, pass, value]) => `${pass ? 'PASS' : 'TODO'} ${label}: ${value}`)].join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getAuditLogs',
      description: 'Get recent audit logs. Admin only.',
      schema: z.object({ limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(), action: z.string().optional(), resourceType: z.string().optional() }),
      func: async ({ limit, action, resourceType }) => {
        const denied = adminOnly(context); if (denied) return denied;
        const logs = await prisma.auditLog.findMany({ where: { companyId: context.companyId, ...(action ? { action } : {}), ...(resourceType ? { resourceType } : {}) }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: limit ?? DEFAULT_AUDIT_LOG_LIMIT });
        if (!logs.length) return 'No audit logs found.';
        return ['*Audit Logs*', ...logs.map((log) => `${formatDateIST(log.createdAt)} ${log.action}\nUser: ${log.user?.name ?? 'system'}\nResource: ${log.resourceType ?? 'n/a'} ${log.resourceId ?? ''}\nDetails: ${truncate(JSON.stringify(log.details ?? {}), 220)}`)].join('\n\n');
      },
    }),
  ];
}
