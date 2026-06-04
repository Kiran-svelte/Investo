import config from '../config';
import logger from '../config/logger';

export interface WhatsAppPresenceConfig {
  provider?: 'meta' | 'greenapi';
  phoneNumberId?: string;
  accessToken?: string;
}

/** Human-like pause before outbound AI text (ms). */
export function computeHumanReplyDelayMs(messageLength: number): number {
  const base = 800;
  const perChar = 12;
  const cap = 4_500;
  const jitter = Math.floor(Math.random() * 400);
  return Math.min(cap, base + messageLength * perChar + jitter);
}

function normalizeTo(to: string): string {
  return to.replace(/\D/g, '').replace(/^0+/, '');
}

/**
 * Meta Cloud API typing indicator (best-effort). GreenAPI: no-op.
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators
 */
export async function sendTypingIndicator(
  to: string,
  whatsappConfig: WhatsAppPresenceConfig,
): Promise<void> {
  const provider = whatsappConfig.provider ?? 'meta';
  if (provider !== 'meta') return;

  const phoneNumberId = whatsappConfig.phoneNumberId;
  const accessToken = whatsappConfig.accessToken;
  if (!phoneNumberId || !accessToken) return;

  try {
    const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizeTo(to),
        typing_indicator: { type: 'text' },
      }),
    });
    if (!response.ok) {
      logger.debug('Typing indicator not supported by API version', { status: response.status });
    }
  } catch (err: unknown) {
    logger.debug('Typing indicator skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function markInboundMessageRead(
  messageId: string | undefined,
  whatsappConfig: WhatsAppPresenceConfig,
): Promise<void> {
  if (!messageId) return;
  const provider = whatsappConfig.provider ?? 'meta';
  if (provider !== 'meta') return;

  const { phoneNumberId, accessToken } = whatsappConfig;
  if (!phoneNumberId || !accessToken) return;

  try {
    await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch {
    // non-blocking
  }
}

/** Typing pulse + natural delay before sending AI reply text. */
export async function simulateHumanReplyPacing(input: {
  to: string;
  whatsappConfig: WhatsAppPresenceConfig;
  outboundTextLength: number;
  inboundMessageId?: string;
}): Promise<void> {
  await markInboundMessageRead(input.inboundMessageId, input.whatsappConfig);
  await sendTypingIndicator(input.to, input.whatsappConfig);
  await new Promise((r) => setTimeout(r, computeHumanReplyDelayMs(input.outboundTextLength)));
}
