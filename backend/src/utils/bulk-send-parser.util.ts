/**
 * @file bulk-send-parser.util.ts
 * @description Single canonical parser for staff "send/forward message to phones" commands.
 *
 * Replaces three divergent parser implementations that existed independently:
 *   1. FORWARD_QUOTED_RE / FORWARD_UNQUOTED_RE in staffMessageForward.service.ts
 *   2. parseBulkForwardRequest() in agent-intent-orchestrator.service.ts
 *
 * All callers must import from this file. Never duplicate this logic.
 *
 * Supported patterns:
 *   - Send "Hello team" to 9876543210, 9019655080
 *   - Forward 'Tomorrow is holiday' to 9876543210 and 9019655080
 *   - Bulk forward "message" to phone1, phone2, phone3
 *   - send message text to 9876543210 9019655080
 *   - Send this "quote" to +91 9876543210
 *
 * Phone matching rules:
 *   - Must be 10+ digits
 *   - Supports optional +91 prefix or 91 prefix
 *   - Separators: comma, semicolon, newline, "and", whitespace-only between numbers
 *
 * @param rawMessage - Full text of the staff message.
 * @returns Parsed body and phone list, or null if the command is not recognised.
 */

import { normalizeInboundWhatsAppPhone } from './phoneMatch';
import logger from '../config/logger';

/** Maximum phone numbers accepted in a single bulk-send command. Prevent abuse. */
export const MAX_BULK_SEND_RECIPIENTS = 20;

export interface BulkSendParseResult {
  /** The message body to send. Trimmed. */
  body: string;
  /** Deduplicated, normalised E.164-ish phone strings. */
  phones: string[];
}

/**
 * Regex matching an Indian mobile or international number.
 * Accepts: 10 digit, 91-prefixed 12 digit, +91 prefixed, spaced variants.
 */
const PHONE_TOKEN_RE = /(?:\+?91[-\s]?)?[6-9]\d{9}/g;

/** Quoted body: anything between matching single or double quotes. */
const QUOTED_BODY_RE = /(?:send|forward|bulk\s+forward)\s+(['"]).+?\1\s+to\s+/i;

/** Normalize smart quotes and invisible Unicode from WhatsApp clients. */
function normalizeBulkCommandText(raw: string): string {
  return raw
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '');
}

/**
 * Extracts all phone numbers from the raw message string.
 * Returns a deduplicated array of normalised phone strings.
 *
 * @param raw - Raw message text from the staff user.
 * @returns Array of normalised phone strings (no duplicates).
 */
function extractPhones(raw: string): string[] {
  const matches = raw.match(PHONE_TOKEN_RE) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const normalised = normalizeInboundWhatsAppPhone(match.replace(/[-\s]/g, ''));
    if (!seen.has(normalised)) {
      seen.add(normalised);
      result.push(normalised);
    }
  }
  return result;
}

/**
 * Extracts the message body from a quoted command.
 * Returns null if no quoted body is found.
 *
 * @param raw - Raw message text.
 * @returns The content inside the first matching quoted section, or null.
 */
function extractQuotedBody(raw: string): string | null {
  const match = raw.match(/['"]([\s\S]+?)['"]/);
  return match ? match[1].trim() : null;
}

/**
 * Extracts the message body from an unquoted send/forward command.
 * Strategy: strip command keyword, phone numbers, and separator words.
 * Returns null if extraction yields an empty or phone-only string.
 *
 * @param raw - Raw message text.
 * @returns Extracted body text or null.
 */
function extractUnquotedBody(raw: string): string | null {
  // Strip phone numbers first
  const withoutPhones = raw.replace(PHONE_TOKEN_RE, '').replace(/,\s*/g, ' ');
  // Strip "send/forward/bulk forward ... to" prefix
  const bodyMatch = withoutPhones.match(
    /^(?:bulk\s+forward|forward|send)\s+(.*?)(?:\s+to\s+.*)?$/i,
  );
  if (!bodyMatch) return null;
  const candidate = bodyMatch[1]
    .replace(/\bto\b/gi, '')
    .replace(/\b(bulk|forward|send|and)\b/gi, '')
    .replace(/[,;]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Reject if the remaining body is suspiciously short or looks like only a phone
  if (!candidate || candidate.length < 3 || /^[\d\s+]+$/.test(candidate)) return null;
  return candidate;
}

/**
 * Checks whether the message matches the send/forward command prefix.
 *
 * @param raw - Raw message text to test.
 * @returns true when the message starts with a recognised send/forward keyword.
 */
function isSendCommand(raw: string): boolean {
  return /^(?:bulk\s+forward|forward|send)\b/i.test(raw.trim());
}

/**
 * Parse a staff bulk-send command into a structured result.
 *
 * Attempts quoted extraction first (more precise), then unquoted fallback.
 * Returns null when:
 *   - the message does not look like a send/forward command
 *   - no valid phones are found
 *   - body is empty after extraction
 *
 * @param rawMessage - Full staff message text.
 * @returns {@link BulkSendParseResult} or null.
 */
export function parseBulkSendCommand(rawMessage: string): BulkSendParseResult | null {
  const trimmed = normalizeBulkCommandText(rawMessage);

  if (!isSendCommand(trimmed)) return null;

  const phones = extractPhones(trimmed);
  if (phones.length === 0) {
    logger.debug('parseBulkSendCommand: no phones found', {
      preview: trimmed.slice(0, 80),
    });
    return null;
  }

  // Try quoted body first — highest precision
  const hasQuotedPattern = QUOTED_BODY_RE.test(trimmed);
  const body = hasQuotedPattern
    ? (extractQuotedBody(trimmed) ?? extractUnquotedBody(trimmed))
    : extractUnquotedBody(trimmed);

  if (!body) {
    logger.debug('parseBulkSendCommand: body extraction failed', {
      preview: trimmed.slice(0, 80),
    });
    return null;
  }

  const cappedPhones = phones.slice(0, MAX_BULK_SEND_RECIPIENTS);

  logger.debug('parseBulkSendCommand: parsed', {
    phoneCount: cappedPhones.length,
    bodyPreview: body.slice(0, 60),
    hasQuotedPattern,
  });

  return { body, phones: cappedPhones };
}
