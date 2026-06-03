/**
 * Parses customer WhatsApp text into a proposed site-visit datetime.
 * Used to book visits in CRM (calendar + lead status), not only LLM prose.
 */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const VISIT_SCHEDULING_HINT =
  /\b(visit|site\s*visit|come\s+and\s+see|see\s+the\s+property|schedule|book\s+a\s+visit|this\s+saturday|this\s+sunday|tomorrow|today)\b/i;

const TIME_PATTERN =
  /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b|\b(\d{1,2})\s*(am|pm)\b/i;

const DAY_PATTERN = new RegExp(
  `\\b(?:this\\s+)?(${DAY_NAMES.join('|')}|tomorrow|today)\\b`,
  'i',
);

const SHORT_CONFIRM = /^(yes|yeah|yep|ok|okay|sure|confirm|confirmed|done|👍|✅)[!.\s]*$/i;

export function isVisitSchedulingMessage(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  if (SHORT_CONFIRM.test(t)) return true;
  return VISIT_SCHEDULING_HINT.test(t) && (DAY_PATTERN.test(t) || TIME_PATTERN.test(t));
}

export function isShortVisitConfirmation(message: string): boolean {
  return SHORT_CONFIRM.test(message.trim());
}

/**
 * Returns next calendar occurrence of weekday (0=Sun) at given local hours/minutes.
 */
function nextWeekdayAt(
  from: Date,
  targetDow: number,
  hour: number,
  minute: number,
): Date {
  const result = new Date(from);
  result.setSeconds(0, 0);
  const currentDow = result.getDay();
  let delta = (targetDow - currentDow + 7) % 7;
  if (delta === 0) {
    const candidate = new Date(result);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate <= from) {
      delta = 7;
    }
  }
  result.setDate(result.getDate() + delta);
  result.setHours(hour, minute, 0, 0);
  return result;
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
 * Parse a visit datetime from free text (IST-local wall clock, server TZ).
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
    const d = new Date(reference);
    d.setHours(hm.hour, hm.minute, 0, 0);
    if (d <= reference) return null;
    return d;
  }

  if (dayToken === 'tomorrow') {
    const d = new Date(reference);
    d.setDate(d.getDate() + 1);
    d.setHours(hm.hour, hm.minute, 0, 0);
    return d;
  }

  const dow = DAY_NAMES.indexOf(dayToken as (typeof DAY_NAMES)[number]);
  if (dow < 0) return null;
  return nextWeekdayAt(reference, dow, hm.hour, hm.minute);
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
