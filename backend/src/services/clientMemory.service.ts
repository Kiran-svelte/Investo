import prisma from '../config/prisma';
import logger from '../config/logger';
import { formatDateIST } from './agent/tools/format-helpers';
import {
  createTextEmbeddings,
  embeddingVectorLiteral,
} from './propertyKnowledge.service';
import { phoneLast10 } from '../utils/phoneMatch';

const CHUNK_MAX_CHARS = 900;
const DEFAULT_SEARCH_LIMIT = 12;

export type ClientMemorySourceType =
  | 'whatsapp_message'
  | 'visit'
  | 'lead_profile'
  | 'agent_action'
  | 'staff_notification';

export interface ClientMemoryChunk {
  leadId: string;
  content: string;
  sourceType: string;
  score: number;
  createdAt?: Date;
}

let schemaReady: boolean | null = null;

export async function ensureClientMemorySchema(): Promise<void> {
  if (schemaReady === true) return;

  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS client_memory_chunks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      source_type VARCHAR(40) NOT NULL,
      source_id VARCHAR(100) NULL,
      content TEXT NOT NULL,
      embedding vector(1536),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS client_memory_chunks_company_lead_idx ON client_memory_chunks (company_id, lead_id)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS client_memory_chunks_source_uidx ON client_memory_chunks (company_id, lead_id, source_type, source_id) WHERE source_id IS NOT NULL`,
  );

  await prisma.$executeRawUnsafe(`
    ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_lead_id UUID NULL REFERENCES leads(id) ON DELETE SET NULL
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_visit_id UUID NULL
  `);

  schemaReady = true;
}

function splitChunk(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= CHUNK_MAX_CHARS) return [normalized];
  const parts: string[] = [];
  for (let i = 0; i < normalized.length; i += CHUNK_MAX_CHARS) {
    parts.push(normalized.slice(i, i + CHUNK_MAX_CHARS).trim());
  }
  return parts.filter(Boolean);
}

export async function indexClientMemoryChunk(input: {
  companyId: string;
  leadId: string;
  sourceType: ClientMemorySourceType;
  sourceId?: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const content = input.content.trim();
  if (!content) return;

  await ensureClientMemorySchema();
  const [embedding] = await createTextEmbeddings([content.slice(0, CHUNK_MAX_CHARS)]);
  const metadata = JSON.stringify(input.metadata ?? {});

  if (input.sourceId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM client_memory_chunks
       WHERE company_id = $1::uuid AND lead_id = $2::uuid AND source_type = $3 AND source_id = $4`,
      input.companyId,
      input.leadId,
      input.sourceType,
      input.sourceId,
    );
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO client_memory_chunks (
      company_id, lead_id, source_type, source_id, content, embedding, metadata, updated_at
    ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::vector, $7::jsonb, now())`,
    input.companyId,
    input.leadId,
    input.sourceType,
    input.sourceId ?? null,
    content.slice(0, CHUNK_MAX_CHARS),
    embeddingVectorLiteral(embedding),
    metadata,
  );
}

async function leadScopeIds(
  companyId: string,
  userId: string,
  userRole: string,
): Promise<string[] | null> {
  if (userRole !== 'sales_agent') return null;
  const rows = await prisma.lead.findMany({
    where: { companyId, assignedAgentId: userId },
    select: { id: true },
    take: 500,
  });
  return rows.map((r) => r.id);
}

export async function searchClientMemory(input: {
  companyId: string;
  query: string;
  leadId?: string;
  leadIds?: string[];
  userId?: string;
  userRole?: string;
  limit?: number;
}): Promise<ClientMemoryChunk[]> {
  const trimmed = input.query.trim();
  if (!trimmed) return [];

  await ensureClientMemorySchema();

  let leadFilter = input.leadIds ?? (input.leadId ? [input.leadId] : null);
  if (!leadFilter && input.userId && input.userRole) {
    leadFilter = await leadScopeIds(input.companyId, input.userId, input.userRole);
    if (leadFilter?.length === 0) return [];
  }

  const [embedding] = await createTextEmbeddings([trimmed]);
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;

  if (leadFilter?.length) {
    const rows = await prisma.$queryRawUnsafe<Array<{
      lead_id: string;
      content: string;
      source_type: string;
      score: number;
      created_at: Date;
    }>>(
      `SELECT lead_id::text, content, source_type,
              1 - (embedding <=> $1::vector) AS score, created_at
       FROM client_memory_chunks
       WHERE company_id = $2::uuid AND lead_id = ANY($3::uuid[])
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      embeddingVectorLiteral(embedding),
      input.companyId,
      leadFilter,
      limit,
    );
    return rows.map((row) => ({
      leadId: row.lead_id,
      content: row.content,
      sourceType: row.source_type,
      score: Number(row.score),
      createdAt: row.created_at,
    }));
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    lead_id: string;
    content: string;
    source_type: string;
    score: number;
    created_at: Date;
  }>>(
    `SELECT lead_id::text, content, source_type,
            1 - (embedding <=> $1::vector) AS score, created_at
       FROM client_memory_chunks
       WHERE company_id = $2::uuid
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
    embeddingVectorLiteral(embedding),
    input.companyId,
    limit,
  );
  return rows.map((row) => ({
    leadId: row.lead_id,
    content: row.content,
    sourceType: row.source_type,
    score: Number(row.score),
    createdAt: row.created_at,
  }));
}

export function formatClientMemoryForPrompt(chunks: ClientMemoryChunk[], leadName?: string): string {
  if (!chunks.length) return '';
  const header = leadName
    ? `## CLIENT MEMORY (RAG) — ${leadName}`
    : '## CLIENT MEMORY (RAG) — retrieved history';
  const lines = chunks.map(
    (c, i) => `[${i + 1}] (${c.sourceType}, score ${c.score.toFixed(2)})\n${c.content}`,
  );
  return `${header}\nUse this for context about past chats, visits, and actions. Prefer live tools for current status.\n\n${lines.join('\n\n')}`;
}

export async function rebuildLeadClientMemory(leadId: string): Promise<{ chunkCount: number }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      visits: { orderBy: { scheduledAt: 'desc' }, take: 30, include: { property: { select: { name: true } } } },
      conversations: {
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      },
    },
  });
  if (!lead) return { chunkCount: 0 };

  await ensureClientMemorySchema();
  await prisma.$executeRawUnsafe(
    `DELETE FROM client_memory_chunks WHERE lead_id = $1::uuid`,
    leadId,
  );

  let count = 0;
  const profile = [
    `Lead profile: ${lead.customerName ?? 'Unknown'} | phone ${lead.phone}`,
    `Status: ${lead.status} | source: ${lead.source}`,
    lead.locationPreference ? `Area: ${lead.locationPreference}` : '',
    lead.notes ? `Notes: ${lead.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  await indexClientMemoryChunk({
    companyId: lead.companyId,
    leadId,
    sourceType: 'lead_profile',
    sourceId: `profile-${leadId}`,
    content: profile,
  });
  count += 1;

  for (const visit of lead.visits) {
    const content = [
      `Visit ${visit.status} at ${visit.property?.name ?? 'property'}`,
      `Scheduled: ${formatDateIST(visit.scheduledAt)}`,
      visit.notes ? `Notes: ${visit.notes}` : '',
      `Visit ID: ${visit.id}`,
    ]
      .filter(Boolean)
      .join('\n');
    await indexClientMemoryChunk({
      companyId: lead.companyId,
      leadId,
      sourceType: 'visit',
      sourceId: visit.id,
      content,
    });
    count += 1;
  }

  for (const conv of lead.conversations) {
    for (const msg of conv.messages) {
      const label =
        msg.senderType === 'customer'
          ? 'Customer WhatsApp'
          : msg.senderType === 'ai'
            ? 'AI WhatsApp'
            : 'Agent WhatsApp';
      await indexClientMemoryChunk({
        companyId: lead.companyId,
        leadId,
        sourceType: 'whatsapp_message',
        sourceId: msg.id,
        content: `${formatDateIST(msg.createdAt)} ${label}: ${msg.content}`,
        metadata: { conversationId: conv.id },
      });
      count += 1;
    }
  }

  const actions = await prisma.agentActionLog.findMany({
    where: { companyId: lead.companyId, resourceType: 'lead', resourceId: leadId },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });
  for (const action of actions) {
    await indexClientMemoryChunk({
      companyId: lead.companyId,
      leadId,
      sourceType: 'agent_action',
      sourceId: action.id,
      content: `${formatDateIST(action.createdAt)} Action ${action.action}: ${action.result ?? action.status}`,
    });
    count += 1;
  }

  logger.info('Client memory rebuilt', { leadId, chunkCount: count });
  return { chunkCount: count };
}

export async function syncLeadClientMemory(leadId: string): Promise<void> {
  const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM client_memory_chunks WHERE lead_id = $1::uuid`,
    leadId,
  );
  const existing = Number(countRows[0]?.count ?? 0);
  if (existing === 0) {
    await rebuildLeadClientMemory(leadId);
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      companyId: true,
      customerName: true,
      phone: true,
      status: true,
      notes: true,
      updatedAt: true,
    },
  });
  if (!lead) return;

  await indexClientMemoryChunk({
    companyId: lead.companyId,
    leadId,
    sourceType: 'lead_profile',
    sourceId: `profile-${leadId}`,
    content: `Lead profile (updated): ${lead.customerName ?? 'Unknown'} | ${lead.phone} | status ${lead.status}${lead.notes ? ` | ${lead.notes}` : ''}`,
  });

  const latestVisit = await prisma.visit.findFirst({
    where: { leadId },
    orderBy: { updatedAt: 'desc' },
    include: { property: { select: { name: true } } },
  });
  if (latestVisit) {
    await indexClientMemoryChunk({
      companyId: lead.companyId,
      leadId,
      sourceType: 'visit',
      sourceId: latestVisit.id,
      content: `Visit ${latestVisit.status} — ${latestVisit.property?.name ?? 'property'} — ${formatDateIST(latestVisit.scheduledAt)}`,
    });
  }

  const latestMsg = await prisma.message.findFirst({
    where: { conversation: { leadId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, content: true, senderType: true, createdAt: true },
  });
  if (latestMsg) {
    await indexClientMemoryChunk({
      companyId: lead.companyId,
      leadId,
      sourceType: 'whatsapp_message',
      sourceId: latestMsg.id,
      content: `${formatDateIST(latestMsg.createdAt)} ${latestMsg.senderType}: ${latestMsg.content}`,
    });
  }
}

export async function getAgentSessionContext(sessionId: string | undefined): Promise<{
  lastLeadId: string | null;
  lastVisitId: string | null;
}> {
  if (!sessionId) return { lastLeadId: null, lastVisitId: null };
  await ensureClientMemorySchema();
  const rows = await prisma.$queryRawUnsafe<Array<{
    last_lead_id: string | null;
    last_visit_id: string | null;
  }>>(
    `SELECT last_lead_id::text, last_visit_id::text FROM agent_sessions WHERE id = $1::uuid`,
    sessionId,
  );
  return {
    lastLeadId: rows[0]?.last_lead_id ?? null,
    lastVisitId: rows[0]?.last_visit_id ?? null,
  };
}

export async function setAgentSessionClientContext(input: {
  userId: string;
  phone: string;
  leadId?: string | null;
  visitId?: string | null;
}): Promise<void> {
  await ensureClientMemorySchema();
  await prisma.$executeRawUnsafe(
    `UPDATE agent_sessions
     SET last_lead_id = COALESCE($3::uuid, last_lead_id),
         last_visit_id = COALESCE($4::uuid, last_visit_id),
         last_active_at = now(),
         updated_at = now()
     WHERE user_id = $1::uuid AND phone = $2 AND status = 'active'`,
    input.userId,
    input.phone,
    input.leadId ?? null,
    input.visitId ?? null,
  );
}

export async function resolveLeadContextForAgent(input: {
  companyId: string;
  userId: string;
  userRole: string;
  messageText: string;
  sessionLeadId?: string | null;
  sessionVisitId?: string | null;
}): Promise<{ leadId: string | null; visitId: string | null; leadName: string | null }> {
  const text = input.messageText.trim();

  if (input.sessionVisitId && /\b(confirm|that|this|the)\b.*\bvisit\b/i.test(text)) {
    const visit = await prisma.visit.findFirst({
      where: { id: input.sessionVisitId, companyId: input.companyId },
      select: { id: true, leadId: true, lead: { select: { customerName: true } } },
    });
    if (visit?.leadId) {
      return { leadId: visit.leadId, visitId: visit.id, leadName: visit.lead?.customerName ?? null };
    }
  }

  if (input.sessionLeadId && text.length < 80) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.sessionLeadId, companyId: input.companyId },
      select: { id: true, customerName: true },
    });
    if (lead) return { leadId: lead.id, visitId: input.sessionVisitId ?? null, leadName: lead.customerName };
  }

  const phoneMatch = text.match(/\+?\d{10,14}/);
  if (phoneMatch) {
    const last10 = phoneLast10(phoneMatch[0]);
    const lead = await prisma.lead.findFirst({
      where: { companyId: input.companyId, phone: { contains: last10 } },
      select: { id: true, customerName: true },
    });
    if (lead) return { leadId: lead.id, visitId: null, leadName: lead.customerName };
  }

  const tokens = text.split(/\s+/).filter((t) => t.length >= 3 && /^[a-z]/i.test(t));
  for (const token of tokens.slice(0, 3)) {
    const lead = await prisma.lead.findFirst({
      where: {
        companyId: input.companyId,
        ...(input.userRole === 'sales_agent' ? { assignedAgentId: input.userId } : {}),
        customerName: { contains: token, mode: 'insensitive' },
      },
      select: { id: true, customerName: true },
    });
    if (lead) return { leadId: lead.id, visitId: null, leadName: lead.customerName };
  }

  if (/\b(confirm|visit)\b/i.test(text)) {
    const visit = await prisma.visit.findFirst({
      where: {
        companyId: input.companyId,
        status: { in: ['scheduled', 'confirmed'] },
        scheduledAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        ...(input.userRole === 'sales_agent'
          ? { OR: [{ agentId: input.userId }, { lead: { assignedAgentId: input.userId } }] }
          : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, leadId: true, lead: { select: { customerName: true } } },
    });
    if (visit?.leadId) {
      return { leadId: visit.leadId, visitId: visit.id, leadName: visit.lead?.customerName ?? null };
    }
  }

  return { leadId: input.sessionLeadId ?? null, visitId: input.sessionVisitId ?? null, leadName: null };
}

export async function buildClientMemoryContextForAgent(input: {
  companyId: string;
  userId: string;
  userRole: string;
  messageText: string;
  sessionLeadId?: string | null;
  sessionVisitId?: string | null;
}): Promise<{ block: string; leadId: string | null; visitId: string | null }> {
  const resolved = await resolveLeadContextForAgent(input);
  if (resolved.leadId) {
    try {
      await syncLeadClientMemory(resolved.leadId);
    } catch (err: unknown) {
      logger.warn('Client memory sync failed', {
        leadId: resolved.leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const chunks = await searchClientMemory({
    companyId: input.companyId,
    query: input.messageText,
    leadId: resolved.leadId ?? undefined,
    userId: input.userId,
    userRole: input.userRole,
    limit: DEFAULT_SEARCH_LIMIT,
  });

  return {
    block: formatClientMemoryForPrompt(chunks, resolved.leadName ?? undefined),
    leadId: resolved.leadId,
    visitId: resolved.visitId,
  };
}
