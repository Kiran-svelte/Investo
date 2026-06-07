"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCheckpointer = getCheckpointer;
exports.getOrCreateThreadId = getOrCreateThreadId;
exports.getOrCreateAgentSession = getOrCreateAgentSession;
exports.destroyCheckpointer = destroyCheckpointer;
const prisma_1 = __importDefault(require("../../config/prisma"));
const logger_1 = __importDefault(require("../../config/logger"));
const config_1 = __importDefault(require("../../config"));
let checkpointer = null;
let attempted = false;
async function getCheckpointer() {
    if (checkpointer)
        return checkpointer;
    if (attempted)
        return null;
    attempted = true;
    try {
        const { PostgresSaver } = require('@langchain/langgraph-checkpoint-postgres');
        const saver = PostgresSaver.fromConnString(config_1.default.db.url);
        await saver.setup();
        checkpointer = saver;
        logger_1.default.info('Agent AI LangGraph checkpointer initialized');
        return saver;
    }
    catch (error) {
        logger_1.default.warn('Agent AI checkpointer disabled; setup failed', { error: error?.message });
        return null;
    }
}
async function getOrCreateThreadId(userId, phone, companyId) {
    const session = await getOrCreateAgentSession(userId, phone, companyId);
    return session.threadId;
}
/** Returns stable agent session ids for copilot exchange logging. */
async function getOrCreateAgentSession(userId, phone, companyId) {
    const existing = await prisma_1.default.agentSession.findFirst({
        where: { userId, phone, status: 'active' },
        select: { id: true, threadId: true },
        orderBy: { lastActiveAt: 'desc' },
    });
    if (existing) {
        await prisma_1.default.agentSession.update({
            where: { id: existing.id },
            data: { lastActiveAt: new Date() },
        });
        return { id: existing.id, threadId: existing.threadId };
    }
    const threadId = `agent-${userId}-${Date.now()}`;
    const created = await prisma_1.default.agentSession.create({
        data: { userId, phone, companyId, threadId, status: 'active' },
        select: { id: true, threadId: true },
    });
    return created;
}
async function destroyCheckpointer() {
    if (!checkpointer)
        return;
    const maybeEnd = checkpointer.end || checkpointer.close;
    if (typeof maybeEnd === 'function') {
        await maybeEnd.call(checkpointer);
    }
    checkpointer = null;
    attempted = false;
}
