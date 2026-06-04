import prisma from '../../config/prisma';
import type { ToolContext } from './agent-state';
import type { AgentSessionMessage } from './agent-session-messages.service';
import { buildAgentScopeFilter } from './tools/format-helpers';

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

export interface LeadResolveParams {
  leadId?: string;
  leadName?: string;
}

export function extractLeadIdsFromText(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(UUID_RE)) {
    ids.add(match[0].toLowerCase());
  }
  return [...ids];
}

export function extractLeadNamesFromAssistantMessages(
  messages: AgentSessionMessage[],
): Array<{ name: string; leadId?: string }> {
  const names: Array<{ name: string; leadId?: string }> = [];
  const linePattern =
    /\d+\.\s+[\s\S]*?\*([^*]+)\*[\s\S]*?(?:ID:\s*([0-9a-f-]{36}))/gi;

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;

    for (const match of msg.content.matchAll(linePattern)) {
      const name = match[1]?.trim();
      const leadId = match[2]?.toLowerCase();
      if (!name || name.length < 2) continue;
      if (/^(leads?|new leads today|visit|today|tomorrow)$/i.test(name)) continue;
      names.push({ name, leadId });
    }

    const blocks = [...msg.content.matchAll(/\*([^*]+)\*/g)];
    const ids = extractLeadIdsFromText(msg.content);
    for (const block of blocks) {
      const name = block[1]?.trim();
      if (!name || name.length < 2) continue;
      if (/^(leads?|new leads today|visit|today|tomorrow)$/i.test(name)) continue;
      if (names.some((n) => n.name.toLowerCase() === name.toLowerCase())) continue;
      names.push({ name, leadId: ids[0] });
    }
  }
  return names;
}

export async function resolveLeadForIntent(
  context: ToolContext,
  params: Partial<LeadResolveParams>,
  sessionLeadId?: string | null,
  recentMessages: AgentSessionMessage[] = [],
): Promise<{ leadId: string; customerName: string } | null> {
  const scope = buildAgentScopeFilter(context.companyId, context.userRole, context.userId);

  if (params.leadId) {
    const byId = await prisma.lead.findFirst({
      where: { id: params.leadId, ...scope },
      select: { id: true, customerName: true },
    });
    if (byId) return { leadId: byId.id, customerName: byId.customerName ?? 'Unknown' };
  }

  const nameHint = params.leadName?.trim();
  if (nameHint) {
    const byFullName = await prisma.lead.findFirst({
      where: { ...scope, customerName: { contains: nameHint, mode: 'insensitive' } },
      select: { id: true, customerName: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (byFullName) {
      return { leadId: byFullName.id, customerName: byFullName.customerName ?? 'Unknown' };
    }

    const tokens = nameHint.split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length >= 2) {
      const byTokens = await prisma.lead.findMany({
        where: {
          ...scope,
          AND: tokens.map((token) => ({
            customerName: { contains: token, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, customerName: true },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      });
      if (byTokens.length === 1) {
        return { leadId: byTokens[0].id, customerName: byTokens[0].customerName ?? 'Unknown' };
      }
    }

    const fromChat = extractLeadNamesFromAssistantMessages(recentMessages);
    const hintLower = nameHint.toLowerCase();
    for (const entry of fromChat) {
      if (entry.name.toLowerCase().includes(hintLower) || hintLower.includes(entry.name.toLowerCase())) {
        if (entry.leadId) {
          const lead = await prisma.lead.findFirst({
            where: { id: entry.leadId, ...scope },
            select: { id: true, customerName: true },
          });
          if (lead) return { leadId: lead.id, customerName: lead.customerName ?? entry.name };
        }
      }
    }

    for (const id of extractLeadIdsFromText(recentMessages.map((m) => m.content).join('\n'))) {
      const lead = await prisma.lead.findFirst({
        where: { id, ...scope },
        select: { id: true, customerName: true },
      });
      if (lead && (lead.customerName ?? '').toLowerCase().includes(hintLower)) {
        return { leadId: lead.id, customerName: lead.customerName ?? 'Unknown' };
      }
    }
  }

  if (sessionLeadId) {
    const sessionLead = await prisma.lead.findFirst({
      where: { id: sessionLeadId, ...scope },
      select: { id: true, customerName: true },
    });
    if (sessionLead) {
      return { leadId: sessionLead.id, customerName: sessionLead.customerName ?? 'Unknown' };
    }
  }

  return null;
}
