/** Indian Standard Time — all buyer/agent visit times are shown in this zone. */
export const IST_TIMEZONE = 'Asia/Kolkata';

/** IST offset in milliseconds: UTC+05:30 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

type ISTFormatOptions = Intl.DateTimeFormatOptions;

const DEFAULT_IST_OPTIONS: ISTFormatOptions = {
  timeZone: IST_TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Format a UTC Date for human display in IST.
 * Always pass timeZone explicitly so Railway/UTC hosts don't show raw UTC wall time.
 */
export function formatISTDateTime(
  date: Date,
  options: ISTFormatOptions = DEFAULT_IST_OPTIONS,
): string {
  return date.toLocaleString('en-IN', { ...DEFAULT_IST_OPTIONS, ...options });
}

/** Long-form buyer-facing visit datetime (e.g. "Friday, 12 Jun, 10:00 am"). */
export function formatISTDateTimeLong(date: Date): string {
  return formatISTDateTime(date, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Short date label for WhatsApp slot buttons (e.g. "Fri, 12 Jun"). */
export function formatISTShortDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    timeZone: IST_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Date-only label in IST (e.g. "Friday, 12 June"). */
export function formatISTDateLong(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    timeZone: IST_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** Time-only label in IST (e.g. "10:00 am"). */
export function formatISTTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Calendar date in IST plus N days, returned as a UTC Date at IST midnight
 * (used for slot button labels aligned with resolveVisitSlotToDate).
 */
export function getISTDatePlusDays(days: number, fromMs: number = Date.now()): Date {
  const nowIst = new Date(fromMs + IST_OFFSET_MS);
  return new Date(Date.UTC(
    nowIst.getUTCFullYear(),
    nowIst.getUTCMonth(),
    nowIst.getUTCDate() + days,
    0,
    0,
    0,
    0,
  ) - IST_OFFSET_MS);
}
