import logger from '../config/logger';
import { maskPhoneNumberForLogs } from '../utils/maskPhoneNumberForLogs';
import { normalizeInboundWhatsAppPhone } from '../utils/phoneMatch';
import { parseBulkSendCommand, MAX_BULK_SEND_RECIPIENTS } from '../utils/bulk-send-parser.util';

export interface BulkWhatsAppForwardResult {
  body: string;
  sent: string[];
  failed: string[];
}

/**
 * Resolve bulk-forward body + recipient phones from the raw staff message.
 * Parsed phones from the message text always win over LLM-extracted phoneNumbers —
 * the LLM often returns only staff phones it knows from CRM context.
 */
export function resolveBulkForwardPlan(
  rawMessage: string,
  llmMessage?: string | null,
  llmPhones?: string[] | null,
): { body: string; phones: string[] } | null {
  const parsed = parseBulkSendCommand(rawMessage);

  const body =
    (typeof llmMessage === 'string' && llmMessage.trim())
      ? llmMessage.trim()
      : parsed?.body ?? '';

  const parsedPhones = parsed?.phones ?? [];
  const llmNormalized = (Array.isArray(llmPhones) ? llmPhones : [])
    .map(String)
    .map((phone) => phone.trim())
    .filter(Boolean)
    .map((phone) => normalizeInboundWhatsAppPhone(phone));

  const merged = parsedPhones.length > 0
    ? parsedPhones
    : Array.from(new Set(llmNormalized));

  if (!body || merged.length === 0) return null;

  return {
    body,
    phones: merged.slice(0, MAX_BULK_SEND_RECIPIENTS),
  };
}

/**
 * Send the same WhatsApp text to each recipient independently.
 * Uses the staff-bulk outbound claim so every distinct phone is delivered in one copilot turn.
 */
export async function executeBulkWhatsAppForward(input: {
  companyId: string;
  body: string;
  phones: string[];
}): Promise<BulkWhatsAppForwardResult> {
  const { whatsappService } = await import('./whatsapp.service');
  const sent: string[] = [];
  const failed: string[] = [];
  const cappedPhones = input.phones.slice(0, MAX_BULK_SEND_RECIPIENTS);

  for (const phone of cappedPhones) {
    const normalized = normalizeInboundWhatsAppPhone(phone);
    try {
      const ok = await whatsappService.sendStaffBulkTextMessage(
        normalized,
        input.body,
        input.companyId,
      );
      if (ok) {
        sent.push(maskPhoneNumberForLogs(normalized));
      } else {
        failed.push(maskPhoneNumberForLogs(normalized));
        logger.warn('bulkWhatsAppForward: Meta send returned false', {
          phone: maskPhoneNumberForLogs(normalized),
          companyId: input.companyId,
        });
      }
    } catch (err: unknown) {
      failed.push(maskPhoneNumberForLogs(normalized));
      logger.warn('bulkWhatsAppForward: send threw', {
        phone: maskPhoneNumberForLogs(normalized),
        companyId: input.companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { body: input.body, sent, failed };
}

export function formatBulkForwardStaffReply(result: BulkWhatsAppForwardResult): string {
  if (!result.sent.length) {
    return (
      `I couldn't deliver that message to any of those numbers. ` +
      `Check the phone format (e.g. 9036165603, 919876543210).` +
      (result.failed.length ? `\n\nFailed: ${result.failed.join(', ')}` : '')
    );
  }

  const lines = [
    `*Message sent* to ${result.sent.length} number${result.sent.length === 1 ? '' : 's'}:`,
    ...result.sent.map((phone) => `• ${phone}`),
  ];
  if (result.failed.length) {
    lines.push('', `Failed: ${result.failed.join(', ')}`);
  }
  lines.push(
    '',
    `Message: "${result.body.slice(0, 200)}${result.body.length > 200 ? '…' : ''}"`,
  );
  return lines.join('\n');
}

export function formatBulkForwardIntentReply(result: BulkWhatsAppForwardResult): string {
  return [
    '📤 *Bulk Forward Complete*',
    '',
    `Message: _"${result.body.slice(0, 80)}${result.body.length > 80 ? '…' : ''}"_`,
    '',
    result.sent.length ? `✅ Sent to (${result.sent.length}): ${result.sent.join(', ')}` : null,
    result.failed.length ? `❌ Failed (${result.failed.length}): ${result.failed.join(', ')}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
