/**
 * Parses customer WhatsApp text into a proposed site-visit datetime.
 * Used to book visits in CRM (calendar + lead status), not only LLM prose.
 *
 * TIMEZONE RULE: All Date values returned are built as explicit IST ISO strings
 * (`YYYY-MM-DDTHH:MM:00+05:30`) so the UTC value stored in the DB is always
 * correct regardless of the server process timezone (which may be UTC).
 * Never use `date.setHours(h, m, 0, 0)` for visit times — that operates in
 * server local time and silently shifts by 5:30h on UTC servers.
 */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const VISIT_SCHEDULING_HINT =
  /\b(visit|site\s*visit|come\s+and\s+see|see\s+the\s+property|schedule|book\s+a\s+visit|this\s+saturday|this\s+sunday|tomorrow|today)\b/i;

const TIME_PATTERN =
  /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b|\b(\d{1,2})\s*(am|pm)\b/i;

/**
 * Shared pattern source for day-name matching.
 * Always build fresh RegExp instances from this string — never share one global
 * RegExp across multiple calls, as `lastIndex` state causes non-deterministic
 * match skipping: .test() and .match() reset lastIndex; .matchAll() requires `g`.
 */
const DAY_PATTERN_SOURCE = `\\b(?:this\\s+)?(${DAY_NAMES.join('|')}|tomorrow|today)\\b`;

/** Non-global variant for .test() and single .match() operations. */
const DAY_PATTERN = new RegExp(DAY_PATTERN_SOURCE, 'i');

const SHORT_CONFIRM = /^(yes|yeah|yep|ok|okay|sure|confirm|confirmed|done|👍|✅)[!.\s]*$/i;

/** Prepone / move earlier (common in Indian English WhatsApp). */
const VISIT_PREPONE_HINT =
  /\b(pre\s*pone|prepone|advance|bring\s+forward|move\s+up|earlier|postpone)\b/i;

/** Cancel / reschedule site-visit requests (buyer or staff WhatsApp). */
const VISIT_CANCEL_RESCHEDULE_HINT =
  /\b(cancel(?:led|lation)?|call\s+off)\b[\s\S]{0,120}\b(visit|site\s*visit|appointment|booking)\b|\b(reschedule|re-?schedule|move|change|shift|push)\b[\s\S]{0,120}\b(visit|site\s*visit|appointment|booking)\b|\b(visit|site\s*visit|appointment)\b[\s\S]{0,120}\b(cancel|reschedule|re-?schedule|move|change|shift|postpone)\b/i;

/** Softer phrasing: "different day", "another time", "can't make it Friday". */
const VISIT_MUTATION_SOFT_HINT =
  /\b(can'?t\s+make|won'?t\s+be\s+able|not\s+available)\b[\s\S]{0,60}\b(visit|appointment)\b|\b(visit|appointment)\b[\s\S]{0,40}\b(different|another)\s+(day|time|date)\b|\b(change|move|shift)\b[\s\S]{0,40}\b(time|slot|date)\b/i;

import { isBuyerVisitStatusQuery } from './buyerVisitQuery.service';

/** List/query phrasing — must never run cancel/reschedule mutation. */
export function isVisitListQueryMessage(message: string): boolean {
  return isBuyerVisitStatusQuery(message);
}

export function isVisitCancelOrRescheduleMessage(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  if (isVisitListQueryMessage(t)) return false;
  const mentionsVisit =
    /\b(visit|site\s*visit|appointment|booking)\b/i.test(t);
  if (VISIT_PREPONE_HINT.test(t) && mentionsVisit) return true;
  return VISIT_CANCEL_RESCHEDULE_HINT.test(t) || VISIT_MUTATION_SOFT_HINT.test(t);
}

/**
 * Prefer the new slot after "reschedule to …" / "move to …" when both old and new days appear.
 * Also handles day-only messages like "move visit to friday" with no explicit time
 * by defaulting to 10:00 IST so the reschedule never silently fails.
 */
export function parseRescheduleTargetFromMessage(
  message: string,
  reference = new Date(),
): Date | null {
  const text = message.trim();
  if (!text) return null;

  // 1. Try explicit "reschedule/move/prepone to <target>" tail — most precise.
  const tailMatch = text.match(
    /\b(?:reschedule(?:\s+it)?\s+to|rescheduled?\s+to|move\s+(?:it\s+)?to|change\s+(?:it\s+)?to|pre\s*pone(?:\s+\w+)*\s+to|prepone(?:\s+\w+)*\s+to)\b([\s\S]+)$/i,
  );
  if (tailMatch?.[1]) {
    const tail = tailMatch[1].trim();
    const fromTail = parseVisitDateTimeFromMessage(tail, reference);
    if (fromTail) return fromTail;

    // Tail has a recognisable day but no time — default to 10:00 IST.
    const dayOnly = tail.match(new RegExp(DAY_PATTERN_SOURCE, 'i'));
    if (dayOnly) {
      const synthetic = `${dayOnly[0]} 10am`;
      const fallback = parseVisitDateTimeFromMessage(synthetic, reference);
      if (fallback) return fallback;
    }
  }

  // 2. Multiple day names: treat LAST as target ("move sunday visit to friday").
  const dayMatches = [...text.toLowerCase().matchAll(new RegExp(DAY_PATTERN_SOURCE, 'gi'))];
  if (dayMatches.length > 1) {
    const lastDay = dayMatches[dayMatches.length - 1][0];
    const timeMatch = text.match(TIME_PATTERN);
    if (timeMatch) {
      const synthetic = `${lastDay} ${timeMatch[0]}`;
      const parsed = parseVisitDateTimeFromMessage(synthetic, reference);
      if (parsed) return parsed;
    }
    // Day found but no time — default 10:00 IST.
    const fallback = parseVisitDateTimeFromMessage(`${lastDay} 10am`, reference);
    if (fallback) return fallback;
  }

  return parseVisitDateTimeFromMessage(text, reference);
}

export function messageReferencesVisitTomorrow(message: string): boolean {
  return /\b(on\s+tomorrow|for\s+tomorrow|tomorrow'?s\s+visit|visit\s+.*\btomorrow\b)\b/i.test(
    message.trim(),
  );
}

export function isVisitSchedulingMessage(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  if (isVisitCancelOrRescheduleMessage(t)) return false;
  if (SHORT_CONFIRM.test(t)) return true;
  return VISIT_SCHEDULING_HINT.test(t) && (DAY_PATTERN.test(t) || TIME_PATTERN.test(t));
}

export function isShortVisitConfirmation(message: string): boolean {
  return SHORT_CONFIRM.test(message.trim());
}



function parseHourMinute(match: RegExpMatchArray): { hour: number; minute: number } | null {
  const h = Number(match[1] ?? match[4]);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  const minute = Number(match[2] ?? 0) || 0;
  let hour = h;
  const ampm = (match[3] ?? match[5] ?? '').toLowerCase();
  if (ampm.startsWith('p') && hour < 12) hour += 12;
  if (ampm.startsWith('a') && hour === 12) hour = 0;
  if (!ampm && hour <= 12 && /\b(\d{1,2})\s*(pm|p\.m)/i.test(match[0])) {
    if (hour < 12) hour += 12;
  }
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Returns the IST date string (YYYY-MM-DD) for the given UTC Date, using
 * the Asia/Kolkata locale formatter. Safe on any server timezone.
 *
 * @param d - UTC Date object
 * @returns IST date string in YYYY-MM-DD format
 */
function toISTDateString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

/**
 * Build a Date at a specific wall-clock time in IST, independent of server
 * timezone. Constructs an explicit ISO 8601 string with +05:30 offset so
 * the UTC value stored in DB is always correct.
 *
 * @param istDateStr - Date part in YYYY-MM-DD format (IST)
 * @param hour - 0-23 hour in IST wall clock
 * @param minute - 0-59 minute
 * @returns Date object at the requested IST wall time
 */
function buildISTDate(istDateStr: string, hour: number, minute: number): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${istDateStr}T${hh}:${mm}:00+05:30`);
}

/**
 * Extract the day-of-week (0=Sunday…6=Saturday) that the user is referencing
 * as the *source* visit in a reschedule message (e.g. "this sunday visit",
 * "my saturday appointment"). Returns null when no clear day is mentioned.
 * Used by findTargetVisit to pick the correct visit to mutate.
 *
 * @param message - Raw user message text
 * @returns day-of-week number or null
 */
export function extractReferencedDayFromMessage(message: string): number | null {
  const text = message.trim().toLowerCase();
  if (!text) return null;

  // "today" / "tomorrow" are handled separately by caller
  if (/\btoday\b/i.test(text)) return new Date().getDay();

  const matches = [...text.matchAll(new RegExp(DAY_PATTERN_SOURCE, 'gi'))];
  if (!matches.length) return null;

  // When multiple day names appear (e.g. "move sunday visit to friday"),
  // use the FIRST one as the source visit day. The last is the new time.
  const firstDay = matches[0][1].toLowerCase();
  const dow = DAY_NAMES.indexOf(firstDay as (typeof DAY_NAMES)[number]);
  return dow >= 0 ? dow : null;
}

/**
 * Get the IST [start, end] Date bounds for the upcoming occurrence of the
 * given day-of-week, starting from now. If the day is today, returns today's bounds.
 *
 * @param targetDow - Day of week (0=Sunday, 6=Saturday)
 * @returns [start, end] UTC Dates covering that full IST calendar day
 */
export function getISTDateBoundsForDow(targetDow: number): [Date, Date] {
  const todayISTStr = toISTDateString(new Date());
  const todayDow = new Date(`${todayISTStr}T12:00:00+05:30`).getDay();
  const delta = (targetDow - todayDow + 7) % 7;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + delta);
  const targetISTStr = toISTDateString(targetDate);
  const start = buildISTDate(targetISTStr, 0, 0);
  const end = buildISTDate(targetISTStr, 23, 59);
  return [start, end];
}

/**
 * Parse a visit datetime from free text.
 * Returns a Date representing the IST wall-clock time the user stated,
 * stored as the correct UTC equivalent. Always uses explicit IST ISO strings
 * so server timezone has no effect.
 *
 * @param message - User message text
 * @param reference - Reference Date for relative terms ('today', 'tomorrow')
 * @returns Parsed Date or null if no recognizable datetime found
 */
export function parseVisitDateTimeFromMessage(message: string, reference = new Date()): Date | null {
  const text = message.trim().toLowerCase();
  if (!text) return null;

  const timeMatch = text.match(TIME_PATTERN);
  if (!timeMatch) return null;
  const hm = parseHourMinute(timeMatch);
  if (!hm) return null;

  const dayMatch = text.match(DAY_PATTERN);
  if (!dayMatch) return null;

  const dayToken = dayMatch[1].toLowerCase();

  if (dayToken === 'today') {
    const todayISTStr = toISTDateString(reference);
    const d = buildISTDate(todayISTStr, hm.hour, hm.minute);
    // Reject past times on today
    if (d <= reference) return null;
    return d;
  }

  if (dayToken === 'tomorrow') {
    const tomorrow = new Date(reference);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISTStr = toISTDateString(tomorrow);
    return buildISTDate(tomorrowISTStr, hm.hour, hm.minute);
  }

  const dow = DAY_NAMES.indexOf(dayToken as (typeof DAY_NAMES)[number]);
  if (dow < 0) return null;

  // Find the next occurrence of this day-of-week in IST
  const refISTStr = toISTDateString(reference);
  const refDow = new Date(`${refISTStr}T12:00:00+05:30`).getDay();
  let delta = (dow - refDow + 7) % 7;
  if (delta === 0) {
    // Same day: only use today if the requested time is in the future
    const candidate = buildISTDate(refISTStr, hm.hour, hm.minute);
    if (candidate <= reference) delta = 7;
  }
  const targetDate = new Date(reference);
  targetDate.setDate(targetDate.getDate() + delta);
  const targetISTStr = toISTDateString(targetDate);
  return buildISTDate(targetISTStr, hm.hour, hm.minute);
}

/**
 * Scan recent customer messages (newest last) for a parseable visit slot.
 */
export function parseVisitDateTimeFromHistory(
  customerMessages: string[],
  reference = new Date(),
): Date | null {
  for (let i = customerMessages.length - 1; i >= 0; i -= 1) {
    const parsed = parseVisitDateTimeFromMessage(customerMessages[i], reference);
    if (parsed) return parsed;
  }
  return null;
}
