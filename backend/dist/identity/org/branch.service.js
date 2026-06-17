"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchService = exports.BranchService = void 0;
const uuid_1 = require("uuid");
const prisma_1 = __importDefault(require("../../config/prisma"));
function prismaClient() {
    return prisma_1.default;
}
class BranchService {
    async list(companyId) {
        const rows = await prismaClient().companyBranch.findMany({
            where: { companyId },
            orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
        });
        return rows.map((row) => this.normalize(row));
    }
    async create(companyId, input) {
        if (input.parent_id) {
            const parent = await prismaClient().companyBranch.findFirst({
                where: { id: input.parent_id, companyId },
            });
            if (!parent)
                throw new Error('Parent branch not found');
        }
        const row = await prismaClient().companyBranch.create({
            data: {
                id: (0, uuid_1.v4)(),
                companyId,
                name: input.name.trim(),
                parentId: input.parent_id || null,
                settings: input.settings || {},
            },
        });
        return this.normalize(row);
    }
    async update(companyId, branchId, input) {
        const existing = await prismaClient().companyBranch.findFirst({
            where: { id: branchId, companyId },
        });
        if (!existing)
            throw new Error('Branch not found');
        if (input.parent_id === branchId) {
            throw new Error('Branch cannot be its own parent');
        }
        const row = await prismaClient().companyBranch.update({
            where: { id: branchId },
            data: {
                name: input.name?.trim() || existing.name,
                parentId: input.parent_id === undefined ? existing.parentId : input.parent_id,
                settings: input.settings === undefined ? existing.settings : input.settings,
            },
        });
        return this.normalize(row);
    }
    async remove(companyId, branchId) {
        const childCount = await prismaClient().companyBranch.count({
            where: { companyId, parentId: branchId },
        });
        if (childCount > 0) {
            throw new Error('Cannot delete branch with child branches');
        }
        const memberCount = await prisma_1.default.user.count({
            where: { companyId, branchId, status: 'active' },
        });
        if (memberCount > 0) {
            throw new Error('Cannot delete branch with assigned team members. Reassign them in Team first.');
        }
        await prismaClient().companyBranch.deleteMany({
            where: { id: branchId, companyId },
        });
    }
    attachMemberCounts(branches, counts) {
        return branches.map((branch) => ({
            ...branch,
            member_count: counts.get(branch.id) || 0,
            children: branch.children ? this.attachMemberCounts(branch.children, counts) : undefined,
        }));
    }
    buildTree(branches) {
        const byId = new Map();
        for (const branch of branches) {
            byId.set(branch.id, { ...branch, children: [] });
        }
        const roots = [];
        for (const branch of byId.values()) {
            if (branch.parent_id && byId.has(branch.parent_id)) {
                byId.get(branch.parent_id).children.push(branch);
            }
            else {
                roots.push(branch);
            }
        }
        return roots;
    }
    normalize(row) {
        return {
            id: row.id,
            company_id: row.companyId,
            name: row.name,
            parent_id: row.parentId,
            settings: row.settings || {},
        };
    }
}
exports.BranchService = BranchService;
exports.branchService = new BranchService();
