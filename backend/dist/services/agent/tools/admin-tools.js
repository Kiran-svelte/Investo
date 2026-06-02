"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminTools = createAdminTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
function adminOnly(context) {
    return (0, format_helpers_1.isAdminRole)(context.userRole) ? null : 'Only admins can use this tool.';
}
function objectValue(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}
function createAdminTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getCompanySettings',
            description: 'Show company settings. Admin only.',
            schema: zod_1.z.object({}),
            func: async () => {
                const denied = adminOnly(context);
                if (denied)
                    return denied;
                const company = await prisma_1.default.company.findUnique({ where: { id: context.companyId } });
                if (!company)
                    return 'Company not found.';
                return [`*Company Settings*`, `Name: ${company.name}`, `Slug: ${company.slug}`, `Status: ${company.status}`, `WhatsApp: ${company.whatsappPhone ?? 'not set'}`, `Settings: ${(0, format_helpers_1.truncate)(JSON.stringify(company.settings ?? {}), 1200)}`].join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'updateCompanySettings',
            description: 'Merge fields into company settings JSON. Admin only.',
            schema: zod_1.z.object({ fields: zod_1.z.record(zod_1.z.unknown()) }),
            func: async ({ fields }) => {
                const denied = adminOnly(context);
                if (denied)
                    return denied;
                const company = await prisma_1.default.company.findUnique({ where: { id: context.companyId }, select: { settings: true } });
                if (!company)
                    return 'Company not found.';
                await prisma_1.default.company.update({ where: { id: context.companyId }, data: { settings: { ...objectValue(company.settings), ...fields } } });
                return `Company settings updated: ${Object.keys(fields).join(', ')}`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getReadinessScore',
            description: 'Get go-live readiness checklist. Admin only.',
            schema: zod_1.z.object({}),
            func: async () => {
                const denied = adminOnly(context);
                if (denied)
                    return denied;
                const [agents, properties, aiSettings, company, leads] = await Promise.all([
                    prisma_1.default.user.count({ where: { companyId: context.companyId, role: 'sales_agent', status: 'active' } }),
                    prisma_1.default.property.count({ where: { companyId: context.companyId, status: 'available' } }),
                    prisma_1.default.aiSetting.findUnique({ where: { companyId: context.companyId } }),
                    prisma_1.default.company.findUnique({ where: { id: context.companyId } }),
                    prisma_1.default.lead.count({ where: { companyId: context.companyId } }),
                ]);
                const checks = [
                    ['Active agents', agents > 0, agents],
                    ['Available properties', properties > 0, properties],
                    ['AI settings', !!aiSettings, aiSettings ? 'yes' : 'no'],
                    ['WhatsApp phone', !!company?.whatsappPhone, company?.whatsappPhone ?? 'not set'],
                    ['Lead pipeline', leads > 0, leads],
                ];
                const score = Math.round((checks.filter(([, pass]) => pass).length / checks.length) * 100);
                return [`*Readiness Score: ${score}%*`, ...checks.map(([label, pass, value]) => `${pass ? 'PASS' : 'TODO'} ${label}: ${value}`)].join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getAuditLogs',
            description: 'Get recent audit logs. Admin only.',
            schema: zod_1.z.object({ limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional(), action: zod_1.z.string().optional(), resourceType: zod_1.z.string().optional() }),
            func: async ({ limit, action, resourceType }) => {
                const denied = adminOnly(context);
                if (denied)
                    return denied;
                const logs = await prisma_1.default.auditLog.findMany({ where: { companyId: context.companyId, ...(action ? { action } : {}), ...(resourceType ? { resourceType } : {}) }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: limit ?? agent_tools_constants_1.DEFAULT_AUDIT_LOG_LIMIT });
                if (!logs.length)
                    return 'No audit logs found.';
                return ['*Audit Logs*', ...logs.map((log) => `${(0, format_helpers_1.formatDateIST)(log.createdAt)} ${log.action}\nUser: ${log.user?.name ?? 'system'}\nResource: ${log.resourceType ?? 'n/a'} ${log.resourceId ?? ''}\nDetails: ${(0, format_helpers_1.truncate)(JSON.stringify(log.details ?? {}), 220)}`)].join('\n\n');
            },
        }),
    ];
}
