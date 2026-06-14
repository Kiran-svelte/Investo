import config from '../config';
import logger from '../config/logger';
import { isReplyPacingDisabled } from '../utils/whatsappReplySpeed.util';

export type ReplyPacingMode = 'full' | 'minimal' | 'none';

export interface WhatsAppPresenceConfig {
  provider?: 'meta';
  phoneNumberId?: string;
  accessToken?: string;
}

/** Human-like pause before outbound AI text (ms). */
export function computeHumanReplyDelayMs(
  messageLength: number,
  mode: ReplyPacingMode = 'full',
): number {
  if (mode === 'none') return 0;
  const base = mode === 'minimal' ? 100 : 200;
  const perChar = mode === 'minimal' ? 1 : 3;
  const cap = mode === 'minimal' ? 400 : 1_200;
  const jitter = mode === 'minimal' ? 0 : Math.floor(Math.random() * 150);
  return Math.min(cap, base + messageLength * perChar + jitter);
}

function normalizeTo(to: string): string {
  return to.replace(/\D/g, '').replace(/^0+/, '');
}

export function isReplyPacingGloballyDisabled(): boolean {
  return isReplyPacingDisabled();
}

/** Default ON — typing while the server processes (independent of artificial post-reply delay). */
export function isTypingDuringProcessingEnabled(): boolean {
  if (process.env.WHATSAPP_TYPING_DURING_PROCESSING === 'false') return false;
  return true;
}

/** Meta typing indicators expire; refresh before they drop off (~25s). */
const TYPING_REFRESH_MS = 20_000;

export type TypingSession = { stop: () => void };

/**
 * Show "typing…" for the full inbound processing window (LLM + DB), not only the brief pre-send pulse.
 * Fast-reply mode disables artificial delay after the reply is ready but keeps this session active.
 */
export function startTypingDuringProcessing(
  to: string,
  whatsappConfig: WhatsAppPresenceConfig,
): TypingSession {
  if (!isTypingDuringProcessingEnabled()) {
    return { stop: () => undefined };
  }

  let stopped = false;
  const pulse = () => {
    if (!stopped) void sendTypingIndicator(to, whatsappConfig);
  };

  pulse();
  const interval = setInterval(pulse, TYPING_REFRESH_MS);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
    },
  };
}

/**
 * Meta Cloud API typing indicator (best-effort).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators
 */
export async function sendTypingIndicator(
  to: string,
  whatsappConfig: WhatsAppPresenceConfig,
): Promise<void> {
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
  pacing?: ReplyPacingMode;
  replyPacing?: ReplyPacingMode;
}): Promise<void> {
  const mode = input.replyPacing ?? input.pacing ?? 'full';
  if (mode === 'none') return;

  await markInboundMessageRead(input.inboundMessageId, input.whatsappConfig);
  if (mode === 'full' && !isReplyPacingGloballyDisabled()) {
    await sendTypingIndicator(input.to, input.whatsappConfig);
  }
  if (!isReplyPacingGloballyDisabled()) {
    await new Promise((r) => setTimeout(r, computeHumanReplyDelayMs(input.outboundTextLength, mode)));
  }
}
