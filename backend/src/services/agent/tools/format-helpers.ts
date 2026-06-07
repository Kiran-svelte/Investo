import {
  INDIA_LOCALE,
  INR_CURRENCY,
  IST_TIMEZONE,
  PHONE_MASK_CHAR,
  PHONE_VISIBLE_PREFIX_LENGTH,
  PHONE_VISIBLE_SUFFIX_LENGTH,
  STATUS_EMOJI,
} from '../../../constants/agent-tools.constants';

export function formatDateIST(date: Date): string {
  return new Intl.DateTimeFormat(INDIA_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: IST_TIMEZONE,
  }).format(date);
}

export function formatCurrencyINR(amount: number | string | { toNumber?: () => number } | null | undefined): string {
  const numeric =
    typeof amount === 'number'
      ? amount
      : typeof amount === 'string'
        ? Number(amount)
        : amount?.toNumber?.() ?? 0;
  return new Intl.NumberFormat(INDIA_LOCALE, {
    style: 'currency',
    currency: INR_CURRENCY,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return 'N/A';
  const cleaned = phone.replace(/\s+/g, '');
  const visible = PHONE_VISIBLE_PREFIX_LENGTH + PHONE_VISIBLE_SUFFIX_LENGTH;
  if (cleaned.length <= visible) return cleaned;
  return `${cleaned.slice(0, PHONE_VISIBLE_PREFIX_LENGTH)}${PHONE_MASK_CHAR.repeat(cleaned.length - visible)}${cleaned.slice(-PHONE_VISIBLE_SUFFIX_LENGTH)}`;
}

export function getStatusEmoji(status: string): string {
  return STATUS_EMOJI[status] ?? '';
}

/** Human-readable pipeline / visit status for WhatsApp (no snake_case). */
export function formatStatusLabel(status: string): string {
  const map: Record<string, string> = {
    new: 'New',
    contacted: 'Contacted',
    qualified: 'Qualified',
    visit_scheduled: 'Visit scheduled',
    visited: 'Visited',
    negotiation: 'Negotiation',
    closed_won: 'Closed won',
    closed_lost: 'Closed lost',
    scheduled: 'Scheduled',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No-show',
    rescheduled: 'Rescheduled',
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

/** Max rows in a single staff CRM WhatsApp list before truncating. */
export const CRM_WHATSAPP_LIST_LIMIT = 8;

export function getISTDayBounds(dateString: string): [Date, Date] {
  return [
    new Date(`${dateString}T00:00:00+05:30`),
    new Date(`${dateString}T23:59:59.999+05:30`),
  ];
}

export function getTodayIST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: IST_TIMEZONE });
}

export function getTomorrowIST(): string {
  const anchor = new Date(`${getTodayIST()}T12:00:00+05:30`);
  anchor.setDate(anchor.getDate() + 1);
  return anchor.toLocaleDateString('sv-SE', { timeZone: IST_TIMEZONE });
}

/** Sales agents see visits they own or visits for leads assigned to them. */
export function buildVisitScopeFilter(
  companyId: string,
  userRole: string,
  userId: string,
): Record<string, unknown> {
  if (userRole === 'sales_agent') {
    return {
      companyId,
      OR: [{ agentId: userId }, { lead: { assignedAgentId: userId } }],
    };
  }
  return { companyId };
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(maxLength - 3, 0))}...`;
}

export function isAdminRole(role: string): boolean {
  return role === 'company_admin' || role === 'super_admin';
}

export function buildAgentScopeFilter(
  companyId: string,
  userRole: string,
  userId: string,
  agentField = 'assignedAgentId',
): Record<string, string> {
  const filter: Record<string, string> = { companyId };
  if (userRole === 'sales_agent') filter[agentField] = userId;
  return filter;
}
