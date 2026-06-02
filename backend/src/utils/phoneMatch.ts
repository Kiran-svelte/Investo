import { normalizeIndianPhoneNumber } from '../models/validation';

/** Digits only (no country code logic). */
export function phoneDigitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Last 10 digits for Indian mobile matching. */
export function phoneLast10(phone: string): string | null {
  const digits = phoneDigitsOnly(phone);
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/**
 * Normalize to E.164 when possible (+91XXXXXXXXXX for India).
 */
export function normalizeInboundWhatsAppPhone(phone: string): string {
  const normalized = normalizeIndianPhoneNumber(phone);
  if (typeof normalized === 'string' && normalized.trim()) {
    return normalized.trim();
  }
  const digits = phoneDigitsOnly(phone);
  if (!digits) return phone.trim();
  return phone.trim().startsWith('+') ? phone.trim() : `+${digits}`;
}

export function phonesMatchLast10(a: string, b: string): boolean {
  const a10 = phoneLast10(a);
  const b10 = phoneLast10(b);
  if (!a10 || !b10) return false;
  return a10 === b10;
}
