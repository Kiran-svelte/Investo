/** Format 10-digit local input as +91XXXXXXXXXX for API. */
export function formatIndianPhoneForApi(localDigits: string): string | null {
  const digits = localDigits.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  const trimmed = localDigits.trim();
  if (trimmed.startsWith('+91') && digits.length === 12) return `+${digits}`;
  return trimmed.startsWith('+') ? trimmed : `+91${digits}`;
}

export function stripIndianCountryCode(e164: string): string {
  return e164.replace(/^\+91/, '').replace(/\D/g, '').slice(-10);
}
