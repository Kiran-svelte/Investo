import prisma from '../config/prisma';
import logger from '../config/logger';

/** Centralized AI memory blob stored on leads.lead_memory. */
export interface LeadMemory {
  version: 1;
  updatedAt: string;
  projectsDiscussed?: Array<{
    propertyId?: string;
    name?: string;
    factsShown?: string[];
  }>;
  budget?: { min?: number; max?: number; currency?: string };
  locationPreference?: string;
  upcomingVisits?: Array<{
    visitId: string;
    propertyName?: string;
    scheduledAt: string;
    status: string;
  }>;
  lastIntent?: string;
  conversationSummary?: string;
  openQuestions?: string[];
}

const EMPTY_MEMORY = (): LeadMemory => ({
  version: 1,
  updatedAt: new Date().toISOString(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLeadMemory(raw: unknown): LeadMemory {
  if (!isRecord(raw)) return EMPTY_MEMORY();
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    projectsDiscussed: Array.isArray(raw.projectsDiscussed)
      ? (raw.projectsDiscussed as LeadMemory['projectsDiscussed'])
      : undefined,
    budget: isRecord(raw.budget) ? (raw.budget as LeadMemory['budget']) : undefined,
    locationPreference: typeof raw.locationPreference === 'string' ? raw.locationPreference : undefined,
    upcomingVisits: Array.isArray(raw.upcomingVisits)
      ? (raw.upcomingVisits as LeadMemory['upcomingVisits'])
      : undefined,
    lastIntent: typeof raw.lastIntent === 'string' ? raw.lastIntent : undefined,
    conversationSummary: typeof raw.conversationSummary === 'string' ? raw.conversationSummary : undefined,
    openQuestions: Array.isArray(raw.openQuestions)
      ? raw.openQuestions.filter((q): q is string => typeof q === 'string')
      : undefined,
  };
}

/** Fetch lead memory from DB; backfills from lead + visits on first read. */
export async function getLeadMemory(leadId: string): Promise<LeadMemory> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      leadMemory: true,
      budgetMin: true,
      budgetMax: true,
      locationPreference: true,
      status: true,
      visits: {
        where: { status: { in: ['scheduled', 'confirmed'] }, scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: 'asc' },
        take: 3,
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          property: { select: { name: true } },
        },
      },
    },
  });
  if (!lead) return EMPTY_MEMORY();

  if (lead.leadMemory) {
    return parseLeadMemory(lead.leadMemory);
  }

  const backfill: LeadMemory = {
    ...EMPTY_MEMORY(),
    budget: {
      min: lead.budgetMin ? Number(lead.budgetMin) : undefined,
      max: lead.budgetMax ? Number(lead.budgetMax) : undefined,
      currency: 'INR',
    },
    locationPreference: lead.locationPreference ?? undefined,
    upcomingVisits: lead.visits.map((v) => ({
      visitId: v.id,
      propertyName: v.property?.name ?? undefined,
      scheduledAt: v.scheduledAt.toISOString(),
      status: v.status,
    })),
  };

  await prisma.lead.update({
    where: { id: leadId },
    data: { leadMemory: backfill as object },
  }).catch(() => undefined);

  return backfill;
}

/** Atomic JSON merge into leads.lead_memory. */
export async function patchLeadMemory(leadId: string, delta: Partial<LeadMemory>): Promise<void> {
  try {
    const current = await getLeadMemory(leadId);
    const merged: LeadMemory = {
      ...current,
      ...delta,
      version: 1,
      updatedAt: new Date().toISOString(),
      projectsDiscussed: delta.projectsDiscussed ?? current.projectsDiscussed,
      budget: delta.budget ? { ...current.budget, ...delta.budget } : current.budget,
      upcomingVisits: delta.upcomingVisits ?? current.upcomingVisits,
      openQuestions: delta.openQuestions ?? current.openQuestions,
    };
    await prisma.lead.update({
      where: { id: leadId },
      data: { leadMemory: merged as object },
    });
  } catch (err: unknown) {
    logger.warn('patchLeadMemory failed', {
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Formatted block for LLM prompt injection (~400 token cap). */
export async function buildPromptMemoryBlock(leadId: string): Promise<string> {
  const memory = await getLeadMemory(leadId);
  const lines: string[] = ['## Lead memory (known facts)'];

  if (memory.budget?.min || memory.budget?.max) {
    const min = memory.budget.min ? `₹${(memory.budget.min / 1e7).toFixed(2)}Cr` : '?';
    const max = memory.budget.max ? `₹${(memory.budget.max / 1e7).toFixed(2)}Cr` : '?';
    lines.push(`- Budget: ${min} – ${max}`);
  }
  if (memory.locationPreference) {
    lines.push(`- Location preference: ${memory.locationPreference}`);
  }
  if (memory.projectsDiscussed?.length) {
    for (const p of memory.projectsDiscussed.slice(0, 3)) {
      const facts = p.factsShown?.length ? ` (${p.factsShown.join(', ')})` : '';
      lines.push(`- Discussed: ${p.name ?? 'property'}${facts}`);
    }
  }
  if (memory.upcomingVisits?.length) {
    for (const v of memory.upcomingVisits.slice(0, 2)) {
      const when = new Date(v.scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      lines.push(`- Visit: ${v.propertyName ?? 'property'} on ${when} (${v.status})`);
    }
  }
  if (memory.lastIntent) {
    lines.push(`- Last intent: ${memory.lastIntent}`);
  }
  if (memory.conversationSummary) {
    lines.push(`- Summary: ${memory.conversationSummary.slice(0, 200)}`);
  }
  if (memory.openQuestions?.length) {
    lines.push(`- Open: ${memory.openQuestions.slice(0, 2).join('; ')}`);
  }

  const block = lines.join('\n');
  return block.length > 1600 ? `${block.slice(0, 1600)}…` : block;
}
