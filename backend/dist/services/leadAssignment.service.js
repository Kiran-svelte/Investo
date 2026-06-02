"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignLeadRoundRobin = assignLeadRoundRobin;
const prisma_1 = __importDefault(require("../config/prisma"));
/**
 * Assign lead to sales agent with fewest active (non-terminal) leads.
 */
async function assignLeadRoundRobin(companyId) {
    const agents = await prisma_1.default.user.findMany({
        where: { companyId, role: 'sales_agent', status: 'active' },
        select: { id: true },
    });
    if (agents.length === 0)
        return null;
    const leadCounts = await prisma_1.default.lead.groupBy({
        by: ['assignedAgentId'],
        where: {
            companyId,
            status: { notIn: ['closed_won', 'closed_lost'] },
            assignedAgentId: { in: agents.map((a) => a.id) },
        },
        _count: { id: true },
    });
    const countMap = new Map(leadCounts.map((l) => [l.assignedAgentId, l._count.id]));
    let minAgent = agents[0].id;
    let minCount = countMap.get(agents[0].id) || 0;
    for (const agent of agents) {
        const count = countMap.get(agent.id) || 0;
        if (count < minCount) {
            minCount = count;
            minAgent = agent.id;
        }
    }
    return minAgent;
}
