/** Lead pipeline — shared labels and Tailwind palettes for list, detail, and analytics. */

export const LEAD_STATUS_ORDER = [
  'new',
  'contacted',
  'visit_scheduled',
  'visited',
  'negotiation',
  'closed_won',
  'closed_lost',
] as const;

export type LeadStatusValue = (typeof LEAD_STATUS_ORDER)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatusValue, string> = {
  new: 'New',
  contacted: 'Contacted',
  visit_scheduled: 'Visit scheduled',
  visited: 'Visited',
  negotiation: 'Negotiation',
  closed_won: 'Closed won',
  closed_lost: 'Closed lost',
};

/** Badge / pill */
export const LEAD_STATUS_STYLES: Record<LeadStatusValue, string> = {
  new: 'bg-sky-100 text-sky-800 border-sky-300',
  contacted: 'bg-amber-100 text-amber-900 border-amber-300',
  visit_scheduled: 'bg-violet-100 text-violet-900 border-violet-300',
  visited: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  negotiation: 'bg-orange-100 text-orange-900 border-orange-300',
  closed_won: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  closed_lost: 'bg-rose-100 text-rose-900 border-rose-300',
};

/** Pipeline bar fill */
export const LEAD_STATUS_BAR: Record<LeadStatusValue, string> = {
  new: 'bg-sky-500',
  contacted: 'bg-amber-500',
  visit_scheduled: 'bg-violet-500',
  visited: 'bg-indigo-500',
  negotiation: 'bg-orange-500',
  closed_won: 'bg-emerald-500',
  closed_lost: 'bg-rose-500',
};

export const LEAD_TRANSITIONS: Record<LeadStatusValue, LeadStatusValue[]> = {
  new: ['contacted'],
  contacted: ['visit_scheduled', 'closed_lost'],
  visit_scheduled: ['visited', 'contacted'],
  visited: ['negotiation', 'closed_lost'],
  negotiation: ['closed_won', 'closed_lost'],
  closed_won: [],
  closed_lost: [],
};

export function formatLeadStatus(status: string): string {
  return LEAD_STATUS_LABELS[status as LeadStatusValue] ?? status.replace(/_/g, ' ');
}

export function leadStatusStyle(status: string): string {
  return LEAD_STATUS_STYLES[status as LeadStatusValue] ?? 'bg-gray-100 text-gray-700 border-gray-300';
}
