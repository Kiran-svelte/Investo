import logger from '../config/logger';
import { logAgentAction } from './agent-action-log.service';
import { normalizeInboundWhatsAppPhone } from '../utils/phoneMatch';
import { maskPhoneNumberForLogs } from '../utils/maskPhoneNumberForLogs';
import type { CompanyUserMatch } from './inboundWhatsAppRouting.service';

const FORWARD_RE = /^send\s+(["'])([\s\S]+?)\1\s+to\s+(.+)$/i;

function parsePhoneList(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => normalizeInboundWhatsAppPhone(part.replace(/^\+/, '+')));
}

export function parseStaffForwardCommand(message: string): { body: string; phones: string[] } | null {
  const match = message.trim().match(FORWARD_RE);
  if (!match) return null;
  const body = match[2].trim();
  const phones = parsePhoneList(match[3]);
  if (!body || phones.length === 0) return null;
  return { body, phones };
}

export async function tryStaffMessageForward(input: {
  user: CompanyUserMatch;
  messageText: string;
}): Promise<{ handled: true; text: string } | { handled: false }> {
  if (input.user.userRole === 'viewer') {
    return { handled: false };
  }
  const parsed = parseStaffForwardCommand(input.messageText);
  if (!parsed) return { handled: false };

  const { whatsappService } = await import('./whatsapp.service');
  const sent: string[] = [];
  const failed: string[] = [];

  for (const phone of parsed.phones) {
    try {
      await whatsappService.sendCompanyTextMessage(phone, parsed.body, input.user.companyId);
      sent.push(maskPhoneNumberForLogs(phone));
    } catch (err: unknown) {
      failed.push(maskPhoneNumberForLogs(phone));
      logger.warn('staffMessageForward: send failed', {
        phone: maskPhoneNumberForLogs(phone),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  void logAgentAction({
    companyId: input.user.companyId,
    triggeredBy: 'agent_tool',
    action: 'staff_forward_whatsapp',
    actorId: input.user.userId,
    actorRole: input.user.userRole,
    resourceType: 'message',
    inputs: { phones: parsed.phones.length, bodyPreview: parsed.body.slice(0, 80) },
    result: `sent=${sent.length} failed=${failed.length}`,
    status: sent.length ? 'success' : 'failed',
  });

  if (!sent.length) {
    return {
      handled: true,
      text: `I couldn't deliver that message to any of those numbers. Check the phone format (e.g. 9036165603,919876543210).`,
    };
  }

  const lines = [
    `*Message sent* to ${sent.length} number${sent.length === 1 ? '' : 's'}:`,
    ...sent.map((p) => `• ${p}`),
  ];
  if (failed.length) {
    lines.push('', `Failed: ${failed.join(', ')}`);
  }
  lines.push('', `Message: "${parsed.body.slice(0, 200)}${parsed.body.length > 200 ? '…' : ''}"`);
  return { handled: true, text: lines.join('\n') };
}
