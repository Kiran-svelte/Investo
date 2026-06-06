import { getLeadMemory } from './lead-memory.service';

const MEMORY_RECALL_PATTERN =
  /\b(what(?:'s| is)\s+my\s+(budget(?:\s+preference)?|preference|location)|what\s+did\s+we\s+discuss|what\s+do\s+you\s+(know|remember)\s+about\s+me|remind\s+me\s+what\s+i\s+said)\b/i;

export function isBuyerMemoryRecallQuery(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  return MEMORY_RECALL_PATTERN.test(t);
}

function formatBudget(min?: number, max?: number): string {
  const fmt = (n: number) => {
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} crore`;
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} lakh`;
    return `₹${n.toLocaleString('en-IN')}`;
  };
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (max) return `up to ${fmt(max)}`;
  if (min) return `from ${fmt(min)}`;
  return 'not set yet';
}

/** Deterministic recall from leads.lead_memory — no LLM. */
export async function buildBuyerMemoryRecallReply(leadId: string): Promise<string | null> {
  const memory = await getLeadMemory(leadId);
  const lines: string[] = [];

  if (memory.budget?.min || memory.budget?.max) {
    lines.push(`Your budget preference is *${formatBudget(memory.budget.min, memory.budget.max)}*.`);
  }
  if (memory.locationPreference) {
    lines.push(`You're looking in *${memory.locationPreference}*.`);
  }
  if (memory.upcomingVisits?.length) {
    const v = memory.upcomingVisits[0];
    const when = new Date(v.scheduledAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    lines.push(`Your upcoming visit to *${v.propertyName ?? 'the property'}* is on ${when}.`);
  }
  const projects = (memory.projectsDiscussed ?? [])
    .map((p) => p.name)
    .filter((name): name is string => Boolean(name && !/^(visit scheduled|visit rescheduled|your visit)$/i.test(name)));
  const uniqueProjects = [...new Set(projects)].slice(0, 3);
  if (uniqueProjects.length) {
    lines.push(`We've discussed *${uniqueProjects.join('*, *')}*.`);
  }

  if (!lines.length) {
    return (
      "I don't have your preferences saved yet. Share your budget, preferred location, and BHK — I'll remember for next time."
    );
  }

  const budgetLine = lines.find((l) => l.includes('budget preference'));
  const otherLines = lines.filter((l) => !l.includes('budget preference'));
  const ordered = budgetLine ? [budgetLine, ...otherLines] : lines;

  return `${ordered.join('\n')}\n\nAnything else you'd like to explore?`;
}
