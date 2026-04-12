export function maskPhoneNumberForLogs(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) {
    return '****';
  }

  if (digits.length <= 4) {
    return `+${'*'.repeat(digits.length)}`;
  }

  const keepPrefixLen = Math.min(2, Math.max(0, digits.length - 4));
  const prefix = digits.slice(0, keepPrefixLen);
  const last4 = digits.slice(-4);
  const maskedLen = Math.max(0, digits.length - keepPrefixLen - 4);

  return `+${prefix}${'*'.repeat(maskedLen)}${last4}`;
}
