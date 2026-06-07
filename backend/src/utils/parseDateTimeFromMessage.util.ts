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
 * Deterministic date/time extraction from natural language (words or numbers).
 * IST-aware for time-only phrases like "call me at 6pm".
 */
export function parseDateTimeFromNaturalLanguage(message: string, reference = new Date()): Date | null {
  const text = message.trim();
  if (!text) return null;

  const timeOnly = parseTimeOnlyIST(text, reference);
  if (timeOnly && timeOnly > reference) return timeOnly;

  const chronoParsed = chrono.parseDate(text, reference, { forwardDate: true });
  if (chronoParsed && chronoParsed > reference) return chronoParsed;

  return null;
}

/** ISO string without milliseconds — for workflow / request attachment. */
export function extractDateTimeIso(message: string, reference = new Date()): string | null {
  const parsed = parseDateTimeFromNaturalLanguage(message, reference);
  if (!parsed) return null;
  return parsed.toISOString().slice(0, 19) + 'Z';
}
