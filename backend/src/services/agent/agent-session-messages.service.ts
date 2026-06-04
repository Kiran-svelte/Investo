import prisma from '../../config/prisma';
import { ensureClientMemorySchema } from '../clientMemory.service';

export type AgentSessionMessageRole = 'staff' | 'assistant';

export interface AgentSessionMessage {
  role: AgentSessionMessageRole;
  content: string;
  createdAt: Date;
}

let messagesSchemaReady = false;

async function ensureAgentSessionMessagesSchema(): Promise<void> {
  if (messagesSchemaReady) return;
  await ensureClientMemorySchema();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agent_session_messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS agent_session_messages_session_created_idx
     ON agent_session_messages (session_id, created_at DESC)`,
  );
  messagesSchemaReady = true;
}

export async function appendAgentSessionMessage(input: {
  sessionId: string;
  role: AgentSessionMessageRole;
  content: string;
}): Promise<void> {
  const text = input.content.trim();
  if (!text) return;
  await ensureAgentSessionMessagesSchema();
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_session_messages (session_id, role, content) VALUES ($1::uuid, $2, $3)`,
    input.sessionId,
    input.role,
    text.slice(0, 4000),
  );
}

export async function getRecentAgentSessionMessages(
  sessionId: string | undefined,
  limit = 5,
): Promise<AgentSessionMessage[]> {
  if (!sessionId) return [];
  await ensureAgentSessionMessagesSchema();
  const rows = await prisma.$queryRawUnsafe<Array<{
    role: string;
    content: string;
    created_at: Date;
  }>>(
    `SELECT role, content, created_at
     FROM agent_session_messages
     WHERE session_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    sessionId,
    limit,
  );
  return rows
    .map((row) => ({
      role: row.role as AgentSessionMessageRole,
      content: row.content,
      createdAt: row.created_at,
    }))
    .reverse();
}
