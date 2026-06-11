import logger from '../config/logger';
import { logAgentAction } from './agent-action-log.service';
import type { CompanyUserMatch } from './inboundWhatsAppRouting.service';
import { parseBulkSendCommand } from '../utils/bulk-send-parser.util';
import {
  executeBulkWhatsAppForward,
  formatBulkForwardStaffReply,
  resolveBulkForwardPlan,
} from './bulk-whatsapp-forward.service';

/**
 * Re-exported for callers that used the legacy function name.
 * Delegates to the canonical unified parser.
 *
 * @param message - Raw staff message text.
 * @returns Parsed { body, phones } or null.
 */
export function parseStaffForwardCommand(
  message: string,
): { body: string; phones: string[] } | null {
  return parseBulkSendCommand(message);
}

/**
 * Handle a WhatsApp "send/forward message to phones" command from a staff user.
 * Uses the unified bulk-send parser so behaviour is identical to the LLM intent path.
 *
 * @param input.user - Authenticated staff user.
 * @param input.messageText - Raw staff WhatsApp message text.
 * @returns { handled: true, text } if the command was recognised and processed,
 *          { handled: false } to fall through to the next handler.
 * @throws Never — all send failures are caught and surfaced in the reply text.
 */
export async function tryStaffMessageForward(input: {
  user: CompanyUserMatch;
  messageText: string;
}): Promise<{ handled: true; text: string } | { handled: false }> {
  if (input.user.userRole === 'viewer') {
    return { handled: false };
  }

  const plan = resolveBulkForwardPlan(input.messageText);
  if (!plan) return { handled: false };

  const result = await executeBulkWhatsAppForward({
    companyId: input.user.companyId,
    body: plan.body,
    phones: plan.phones,
  });

  void logAgentAction({
    companyId: input.user.companyId,
    triggeredBy: 'agent_tool',
    action: 'staff_forward_whatsapp',
    actorId: input.user.userId,
    actorRole: input.user.userRole,
    resourceType: 'message',
    inputs: { phones: plan.phones.length, bodyPreview: plan.body.slice(0, 80) },
    result: `sent=${result.sent.length} failed=${result.failed.length}`,
    status: result.sent.length ? 'success' : 'failed',
  });

  if (!result.sent.length && !result.failed.length) {
    logger.warn('staffMessageForward: no recipients after plan resolution', {
      preview: input.messageText.slice(0, 80),
    });
  }

  return { handled: true, text: formatBulkForwardStaffReply(result) };
}
