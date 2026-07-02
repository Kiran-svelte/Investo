import * as chrono from 'chrono-node';

function toISTDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function buildISTDate(istDateStr: string, hour: number, minute: number): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${istDateStr}T${hh}:${mm}:00+05:30`);
}

function parseTimeOnlyIST(message: string, reference: Date): Date | null {
  const match = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const isPM = /^p/i.test(match[3]);
  if (isPM && hours < 12) hours += 12;
  if (!isPM && hours === 12) hours = 0;

  const todayIST = toISTDateString(reference);
  let candidate = buildISTDate(todayIST, hours, minutes);
  if (candidate <= reference) {
    const tomorrow = new Date(reference);
    tomorrow.setDate(tomorrow.getDate() + 1);
    candidate = buildISTDate(toISTDateString(tomorrow), hours, minutes);
  }
  return candidate;
}

/**
 * Explicit date words that must win over the time-only IST shortcut.
 * "tomorrow at 1pm" must book tomorrow, not today at 1pm.
 */
const EXPLICIT_DATE_PATTERN =
  /\b(today|tonight|tomm?or?row|tmrw|day\s*after|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?|next\s+(week|month)|this\s+week(end)?|weekend|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b|\d{1,2}[/.-]\d{1,2}|\b\d{1,2}(st|nd|rd|th)\b/i;

/**
 * Deterministic date/time extraction from natural language (words or numbers).
 * IST-aware for time-only phrases like "call me at 6pm"; buyer-facing dates are
 * interpreted in IST regardless of server timezone.
 */
export function parseDateTimeFromNaturalLanguage(message: string, reference = new Date()): Date | null {
  const text = message.trim();
  if (!text) return null;

  const hasExplicitDate = EXPLICIT_DATE_PATTERN.test(text);
  if (!hasExplicitDate) {
    const timeOnly = parseTimeOnlyIST(text, reference);
    if (timeOnly && timeOnly > reference) return timeOnly;
  }

  const chronoParsed = chrono.parseDate(
    text,
    { instant: reference, timezone: 'IST' },
    { forwardDate: true },
  );
  if (chronoParsed && chronoParsed > reference) return chronoParsed;

  const timeOnly = parseTimeOnlyIST(text, reference);
  if (timeOnly && timeOnly > reference) return timeOnly;

  return null;
}

/** ISO string without milliseconds — for workflow / request attachment. */
export function extractDateTimeIso(message: string, reference = new Date()): string | null {
  const parsed = parseDateTimeFromNaturalLanguage(message, reference);
  if (!parsed) return null;
  return parsed.toISOString().slice(0, 19) + 'Z';
}
