import { parseVisitDateTimeFromMessage } from '../services/visitIntentFromMessage.service';
import { parseDateTimeFromNaturalLanguage } from './parseDateTimeFromMessage.util';

const CALL_INTENT =
  /\b(talk\s+to\s+(a\s+)?(human|person|agent|specialist|sales)|speak\s+to\s+(a\s+)?(human|agent|someone)|need\s+to\s+(talk|speak|call)|call\s+me|call\s+back|callback|call\s+back|phone\s+call|request\s+a\s+call|connect\s+me\s+with)\b/i;

const CALL_CANCEL =
  /\b(cancel|call\s+off|stop)\b.*\b(call|callback|phone\s+call)\b|\b(cancel|stop)\s+(my\s+)?(scheduled\s+)?call\b/i;

const CALL_RESCHEDULE =
  /\b(reschedule|move|change|postpone|prepone|push)\b.*\b(call|callback|phone\s+call)\b|\b(call|callback)\b.*\b(reschedule|move|change|postpone)\b/i;

const CALL_STATUS =
  /\b(when\s+(is|was)\s+(my\s+)?call|my\s+call\s+(time|details|status)|scheduled\s+call|callback\s+time)\b/i;

export function isCallBookingIntent(message: string): boolean {
  const t = message.trim();
  if (!t || t.length > 300) return false;
  if (CALL_CANCEL.test(t) || CALL_RESCHEDULE.test(t) || CALL_STATUS.test(t)) return false;
  return CALL_INTENT.test(t);
}

export function isCallCancelIntent(message: string): boolean {
  return CALL_CANCEL.test(message.trim());
}

export function isCallRescheduleIntent(message: string): boolean {
  return CALL_RESCHEDULE.test(message.trim());
}

export function isCallStatusQuery(message: string): boolean {
  return CALL_STATUS.test(message.trim());
}

/**
 * Time-only reply (e.g. "9 pm today") with no visit/book language — usually answers a call-time prompt.
 */
export function isBareSchedulingTimeReply(message: string): boolean {
  const t = message.trim();
  if (!t || t.length > 120) return false;
  if (isCallBookingIntent(t)) return false;
  if (CALL_CANCEL.test(t) || CALL_RESCHEDULE.test(t) || CALL_STATUS.test(t)) return false;
  if (/\b(visit|site\s*visit|appointment|book\s+a\s+visit|schedule\s+a\s+visit)\b/i.test(t)) {
    return false;
  }
  if (/\b(book|schedule)\b/i.test(t)) return false;
  return Boolean(parseDateTimeFromNaturalLanguage(t) ?? parseVisitDateTimeFromMessage(t));
}

/** Default ASAP callback ~15 minutes from now if no time in message. */
export function resolveCallScheduledAt(message: string, reference = new Date()): Date {
  const fromChrono = parseDateTimeFromNaturalLanguage(message, reference);
  if (fromChrono && fromChrono > reference) return fromChrono;

  const parsed = parseVisitDateTimeFromMessage(message, reference);
  if (parsed && parsed > reference) return parsed;

  return new Date(reference.getTime() + 15 * 60 * 1000);
}
