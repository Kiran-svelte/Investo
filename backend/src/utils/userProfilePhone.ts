import { phoneLast10 } from './phoneMatch';

/** Valid staff WhatsApp / CRM phone: E.164 India (+91 + 10 digits). */
export function normalizeStaffProfilePhone(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (trimmed.startsWith('+91') && digits.length === 12) return `+${digits}`;
  if (trimmed.startsWith('+') && digits.length >= 10) {
    const last10 = phoneLast10(trimmed);
    return last10 ? `+91${last10}` : null;
  }
  return null;
}

export function isStaffProfilePhoneComplete(raw: string | null | undefined): boolean {
  return normalizeStaffProfilePhone(raw) !== null;
}
