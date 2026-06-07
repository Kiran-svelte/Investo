import prisma from '../../config/prisma';
import logger from '../../config/logger';
import config from '../../config';

type Checkpointer = any;

let checkpointer: Checkpointer | null = null;
let attempted = false;

export async function getCheckpointer(): Promise<Checkpointer | null> {
  if (checkpointer) return checkpointer;
  if (attempted) return null;
  attempted = true;

  try {
    const { PostgresSaver } = require('@langchain/langgraph-checkpoint-postgres');
    const saver = PostgresSaver.fromConnString(config.db.url);
    await saver.setup();
    checkpointer = saver;
    logger.info('Agent AI LangGraph checkpointer initialized');
    return saver;
  } catch (error: any) {
    logger.warn('Agent AI checkpointer disabled; setup failed', { error: error?.message });
    return null;
  }
}

export async function getOrCreateThreadId(userId: string, phone: string, companyId: string): Promise<string> {
  const session = await getOrCreateAgentSession(userId, phone, companyId);
  return session.threadId;
}

/** Returns stable agent session ids for copilot exchange logging. */
export async function getOrCreateAgentSession(
  userId: string,
  phone: string,
  companyId: string,
): Promise<{ id: string; threadId: string }> {
  const existing = await prisma.agentSession.findFirst({
    where: { userId, phone, status: 'active' },
    select: { id: true, threadId: true },
    orderBy: { lastActiveAt: 'desc' },
  });

  if (existing) {
    await prisma.agentSession.update({
      where: { id: existing.id },
      data: { lastActiveAt: new Date() },
    });
    return { id: existing.id, threadId: existing.threadId };
  }

  const threadId = `agent-${userId}-${Date.now()}`;
  const created = await prisma.agentSession.create({
    data: { userId, phone, companyId, threadId, status: 'active' },
    select: { id: true, threadId: true },
  });
  return created;
}

export async function destroyCheckpointer(): Promise<void> {
  if (!checkpointer) return;
  const maybeEnd = (checkpointer as any).end || (checkpointer as any).close;
  if (typeof maybeEnd === 'function') {
    await maybeEnd.call(checkpointer);
  }
  checkpointer = null;
  attempted = false;
}
