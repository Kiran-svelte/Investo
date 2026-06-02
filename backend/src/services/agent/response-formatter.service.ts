import {
  INDIAN_LOCALE,
  IST_TIMEZONE,
  LEAD_STATUS_EMOJI,
  VISIT_STATUS_EMOJI,
} from '../../constants/agent-ai.constants';
import { formatCurrencyINR as formatCurrency } from './tools/format-helpers';

export function formatDateIST(date: Date): string {
  return new Intl.DateTimeFormat(INDIAN_LOCALE, {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatTimeIST(date: Date): string {
  return new Intl.DateTimeFormat(INDIAN_LOCALE, {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatCurrencyINR(amount: number | string | { toNumber?: () => number } | null | undefined): string {
  return formatCurrency(amount);
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return 'N/A';
  const cleaned = phone.replace(/\s+/g, '');
  if (cleaned.length < 8) return cleaned;
  return `${cleaned.slice(0, 4)}${'X'.repeat(Math.max(cleaned.length - 6, 0))}${cleaned.slice(-2)}`;
}

export function visitStatusEmoji(status: string): string {
  return VISIT_STATUS_EMOJI[status] ?? '';
}

export function leadStatusEmoji(status: string): string {
  return LEAD_STATUS_EMOJI[status] ?? '';
}

export function decimalToNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as any).toNumber === 'function') {
    return (value as any).toNumber();
  }
  return 0;
}
