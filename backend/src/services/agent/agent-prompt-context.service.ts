import prisma from '../../config/prisma';
import { ToolContext } from './agent-state';
import { getRecentAgentSessionMessages } from './agent-session-messages.service';
import { formatDateIST } from './tools/format-helpers';

const FAILURE_RESPONSE_PATTERN =
  /could\s+not|unable\s+to|hit\s+an\s+issue|try\s+again|did\s+not\s+go\s+through|i\s+had\s+trouble/i;

export type AgentPromptContext = {
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
  }>;
  upcomingVisits: Array<{
    id: string;
    projectName: string;
    date: string;
    time: string;
    status: string;
  }>;
  leadStatus: {
    id: string;
    status: string;
    lastInteraction: string;
    interestedProject?: string;
    budgetRange?: string;
  };
  recentErrors: Array<{
    userMessage: string;
    aiResponse: string;
    timestamp: string;
  }>;
};

function formatVisitDateParts(scheduledAt: Date): { date: string; time: string } {
  const formatted = formatDateIST(scheduledAt);
  const commaIdx = formatted.lastIndexOf(',');
  if (commaIdx === -1) {
    return { date: formatted, time: '' };
  }
  return {
    date: formatted.slice(0, commaIdx).trim(),
    time: formatted.slice(commaIdx + 1).trim(),
  };
}

function formatBudgetRange(min: unknown, max: unknown): string | undefined {
  const toNum = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'object' && value !== null && 'toNumber' in value) {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    }
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const minN = toNum(min);
  const maxN = toNum(max);
  if (minN && maxN) return `₹${(minN / 100000).toFixed(1)}L - ₹${(maxN / 100000).toFixed(1)}L`;
  if (minN) return `From ₹${(minN / 100000).toFixed(1)}L`;
  if (maxN) return `Up to ₹${(maxN / 100000).toFixed(1)}L`;
  return undefined;
}

function defaultLeadStatus(): AgentPromptContext['leadStatus'] {
  return {
    id: 'none',
    status: 'no active lead in context',
    lastInteraction: 'N/A',
  };
}

/**
 * Builds structured context injected into the staff copilot system prompt.
 */
export async function buildAgentPromptContext(input: {
  toolContext: ToolContext;
  sessionLeadId?: string | null;
  sessionVisitId?: string | null;
}): Promise<AgentPromptContext> {
  const sessionMessages = await getRecentAgentSessionMessages(input.toolContext.sessionId, 10);
  const conversationHistory = sessionMessages.map((msg) => ({
    role: (msg.role === 'staff' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: msg.content,
    timestamp: msg.createdAt.toISOString(),
  }));

  const recentErrors: AgentPromptContext['recentErrors'] = [];
  for (let i = 1; i < sessionMessages.length; i += 1) {
    const prev = sessionMessages[i - 1];
    const current = sessionMessages[i];
    if (
      prev.role === 'staff' &&
      current.role === 'assistant' &&
      FAILURE_RESPONSE_PATTERN.test(current.content)
    ) {
      recentErrors.push({
        userMessage: prev.content,
        aiResponse: current.content,
        timestamp: current.createdAt.toISOString(),
      });
    }
  }

  let leadId = input.sessionLeadId ?? null;
  if (!leadId && input.sessionVisitId) {
    const visit = await prisma.visit.findFirst({
      where: { id: input.sessionVisitId, companyId: input.toolContext.companyId },
      select: { leadId: true },
    });
    leadId = visit?.leadId ?? null;
  }

  let leadStatus = defaultLeadStatus();
  let upcomingVisits: AgentPromptContext['upcomingVisits'] = [];

  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId: input.toolContext.companyId },
      select: {
        id: true,
        status: true,
        lastContactAt: true,
        updatedAt: true,
        locationPreference: true,
        budgetMin: true,
        budgetMax: true,
        propertyType: true,
      },
    });

    if (lead) {
      const lastInteraction = lead.lastContactAt ?? lead.updatedAt;
      leadStatus = {
        id: lead.id,
        status: lead.status,
        lastInteraction: formatDateIST(lastInteraction),
        interestedProject: lead.locationPreference ?? undefined,
        budgetRange: formatBudgetRange(lead.budgetMin, lead.budgetMax),
      };

      const visits = await prisma.visit.findMany({
        where: {
          companyId: input.toolContext.companyId,
          leadId: lead.id,
          status: { in: ['scheduled', 'confirmed'] },
          scheduledAt: { gte: new Date() },
        },
        include: { property: { select: { name: true } } },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
      });

      upcomingVisits = visits.map((visit) => {
        const { date, time } = formatVisitDateParts(visit.scheduledAt);
        return {
          id: visit.id,
          projectName: visit.property?.name ?? 'Property TBD',
          date,
          time,
          status: visit.status,
        };
      });
    }
  }

  return {
    conversationHistory,
    upcomingVisits,
    leadStatus,
    recentErrors: recentErrors.slice(-3),
  };
}
