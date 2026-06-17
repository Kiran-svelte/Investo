"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOrgBranchesEnabled = isOrgBranchesEnabled;
exports.resolveBranchIdsInScope = resolveBranchIdsInScope;
exports.resolveAgentUserIdsForBranch = resolveAgentUserIdsForBranch;
exports.resolveEffectiveBranchId = resolveEffectiveBranchId;
exports.applyAssignedAgentBranchScope = applyAssignedAgentBranchScope;
exports.applyVisitAgentBranchScope = applyVisitAgentBranchScope;
exports.assertBranchBelongsToCompany = assertBranchBelongsToCompany;
exports.countBranchMembers = countBranchMembers;
const config_1 = __importDefault(require("../../config"));
const prisma_1 = __importDefault(require("../../config/prisma"));
const EMPTY_AGENT_SENTINEL = '00000000-0000-0000-0000-000000000000';
function isOrgBranchesEnabled() {
    return config_1.default.features.orgBranches === true;
}
async function resolveBranchIdsInScope(companyId, branchId) {
    const branches = await prisma_1.default.companyBranch.findMany({
        where: { companyId },
        select: { id: true, parentId: true },
    });
    const ids = new Set([branchId]);
    for (const branch of branches) {
        if (branch.parentId === branchId) {
            ids.add(branch.id);
        }
    }
    return [...ids];
}
async function resolveAgentUserIdsForBranch(companyId, branchId) {
    const branchIds = await resolveBranchIdsInScope(companyId, branchId);
    const users = await prisma_1.default.user.findMany({
        where: {
            companyId,
            branchId: { in: branchIds },
            status: 'active',
        },
        select: { id: true },
    });
    return users.map((user) => user.id);
}
function resolveEffectiveBranchId(user, queryBranchId) {
    if (!isOrgBranchesEnabled()) {
        return null;
    }
    if (user.role === 'company_admin' && queryBranchId) {
        return queryBranchId;
    }
    if (['operations', 'viewer'].includes(user.role) && user.branch_id) {
        return user.branch_id;
    }
    return null;
}
async function applyAssignedAgentBranchScope(where, companyId, user, queryBranchId) {
    if (!isOrgBranchesEnabled()) {
        return;
    }
    if (user.role === 'sales_agent') {
        return;
    }
    const branchId = resolveEffectiveBranchId(user, queryBranchId);
    if (!branchId) {
        return;
    }
    const agentIds = await resolveAgentUserIdsForBranch(companyId, branchId);
    where.assignedAgentId = {
        in: agentIds.length > 0 ? agentIds : [EMPTY_AGENT_SENTINEL],
    };
}
async function applyVisitAgentBranchScope(where, companyId, user, queryBranchId) {
    if (!isOrgBranchesEnabled()) {
        return;
    }
    if (user.role === 'sales_agent') {
        return;
    }
    const branchId = resolveEffectiveBranchId(user, queryBranchId);
    if (!branchId) {
        return;
    }
    const agentIds = await resolveAgentUserIdsForBranch(companyId, branchId);
    where.agentId = {
        in: agentIds.length > 0 ? agentIds : [EMPTY_AGENT_SENTINEL],
    };
}
async function assertBranchBelongsToCompany(companyId, branchId) {
    const branch = await prisma_1.default.companyBranch.findFirst({
        where: { id: branchId, companyId },
        select: { id: true },
    });
    if (!branch) {
        throw new Error('Branch not found');
    }
}
async function countBranchMembers(companyId, branchIds) {
    if (branchIds.length === 0) {
        return new Map();
    }
    const rows = await prisma_1.default.user.groupBy({
        by: ['branchId'],
        where: {
            companyId,
            branchId: { in: branchIds },
            status: 'active',
        },
        _count: { id: true },
    });
    const counts = new Map();
    for (const row of rows) {
        if (row.branchId) {
            counts.set(row.branchId, row._count.id);
        }
    }
    return counts;
}
