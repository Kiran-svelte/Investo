/** True when Postgres rejects an enum literal (e.g. VisitStatus missing pending_approval). */
export function isInvalidPostgresEnumValueError(err: unknown, enumValue?: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('invalid input value for enum')) return false;
  if (enumValue && !message.includes(enumValue)) return false;
  return true;
}

export const UPCOMING_VISIT_STATUSES_WITH_PENDING = [
  'pending_approval',
  'scheduled',
  'confirmed',
] as const;

export const UPCOMING_VISIT_STATUSES_LEGACY = ['scheduled', 'confirmed'] as const;
