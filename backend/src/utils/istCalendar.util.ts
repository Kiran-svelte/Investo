import { IST_OFFSET_MS, IST_TIMEZONE } from './dateTime.util';

export type CompanyWorkingHours = {
  start: string;
  end: string;
};

const DEFAULT_WORKING_HOURS: CompanyWorkingHours = {
  start: '09:00',
  end: '21:00',
};

const HHMM_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** IST calendar date as YYYY-MM-DD (sv-SE locale is ISO-shaped). */
export function getISTDateKey(at: Date = new Date()): string {
  return at.toLocaleDateString('sv-SE', { timeZone: IST_TIMEZONE });
}

/** Minutes since IST midnight for `at` (0–1439). */
export function getISTMinutesSinceMidnight(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * IST calendar-day bounds as UTC Date pair [start, end].
 * Uses Asia/Kolkata — safe on UTC hosts (Railway).
 */
export function istDayBounds(at: Date = new Date()): [Date, Date] {
  const dateKey = getISTDateKey(at);
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_OFFSET_MS);
  const utcEnd = new Date(utcStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  return [utcStart, utcEnd];
}

export function parseHHMMToMinutes(hhmm: string): number | null {
  const match = HHMM_PATTERN.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function parseCompanyWorkingHours(raw: unknown): CompanyWorkingHours {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WORKING_HOURS };
  const record = raw as Record<string, unknown>;
  const start =
    typeof record.start === 'string' && parseHHMMToMinutes(record.start) != null
      ? record.start
      : DEFAULT_WORKING_HOURS.start;
  const end =
    typeof record.end === 'string' && parseHHMMToMinutes(record.end) != null
      ? record.end
      : DEFAULT_WORKING_HOURS.end;
  return { start, end };
}

/**
 * True when `at` falls in [windowStartMinutes, windowStartMinutes + windowMinutes) on the IST day.
 */
export function isISTMinuteWindow(
  at: Date,
  windowStartMinutes: number,
  windowMinutes: number,
): boolean {
  const nowMinutes = getISTMinutesSinceMidnight(at);
  return nowMinutes >= windowStartMinutes && nowMinutes < windowStartMinutes + windowMinutes;
}

/** Default 90-minute window from company shift start — survives deploy/restart gaps. */
export const MORNING_BRIEFING_WINDOW_MINUTES = 90;

/** Default 90-minute window ending ~15 min before company shift end. */
export const EOD_BRIEFING_WINDOW_MINUTES = 90;

/** Minutes before shift end when EOD briefing window opens. */
export const EOD_BRIEFING_LEAD_MINUTES = 15;

export function isMorningBriefingDue(
  workingHours: CompanyWorkingHours,
  at: Date = new Date(),
  windowMinutes: number = MORNING_BRIEFING_WINDOW_MINUTES,
): boolean {
  const startMinutes = parseHHMMToMinutes(workingHours.start);
  if (startMinutes == null) return false;
  return isISTMinuteWindow(at, startMinutes, windowMinutes);
}

export function isEndOfDayBriefingDue(
  workingHours: CompanyWorkingHours,
  at: Date = new Date(),
  windowMinutes: number = EOD_BRIEFING_WINDOW_MINUTES,
): boolean {
  const endMinutes = parseHHMMToMinutes(workingHours.end);
  if (endMinutes == null) return false;
  const windowStart = Math.max(0, endMinutes - EOD_BRIEFING_LEAD_MINUTES);
  return isISTMinuteWindow(at, windowStart, windowMinutes);
}
