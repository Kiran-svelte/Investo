import config from '../config';
import logger from '../config/logger';
import { stripInternalCustomerMeta } from './aiTransparency.service';

export type PolishChannel = 'whatsapp' | 'email' | 'sms';

export interface PolishOutboundInput {
  rawText: string;
  groundedFactsBlock?: string;
  channel?: PolishChannel;
  language?: string;
  maxLength?: number;
}

export interface PolishOutboundResult {
  text: string;
  mode: 'deterministic' | 'llm' | 'passthrough';
}

const WHATSAPP_MAX = 4096;
const DEFAULT_CUSTOMER_MAX = 1200;

/**
 * Refines delivery (formatting, length, tone) without inventing facts.
 * Deterministic by default; optional lightweight LLM when OPENAI/KIMI key is set and POLISH_USE_LLM=1.
 */
export async function polishOutboundMessage(input: PolishOutboundInput): Promise<PolishOutboundResult> {
  const channel = input.channel || 'whatsapp';
  const maxLen = input.maxLength ?? (channel === 'whatsapp' ? DEFAULT_CUSTOMER_MAX : WHATSAPP_MAX);

  let text = stripInternalCustomerMeta(normalizeWhitespace(input.rawText));
  if (!text) {
    return { text: '', mode: 'passthrough' };
  }

  text = applyWhatsAppFormatting(text, channel);
  text = trimToLength(text, maxLen);

  const useLlm = process.env.POLISH_USE_LLM === '1' && Boolean(config.ai.openaiApiKey || config.ai.kimiApiKey);
  if (!useLlm) {
    return { text, mode: 'deterministic' };
  }

  try {
    const polished = await polishWithLlm(text, input.groundedFactsBlock || '', input.language || 'en', maxLen);
    return { text: polished || text, mode: 'llm' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Message polish LLM failed, using deterministic output', { error: message });
    return { text, mode: 'deterministic' };
  }
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function applyWhatsAppFormatting(text: string, channel: PolishChannel): string {
  if (channel !== 'whatsapp') return text;

  // Ensure list bullets are consistent; avoid markdown headers LLMs sometimes emit
  let out = text.replace(/^#{1,3}\s+/gm, '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  return out;
}

function trimToLength(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen - 3);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  if (lastBreak > maxLen * 0.6) {
    return cut.slice(0, lastBreak).trim() + '…';
  }
  return cut.trim() + '…';
}

async function polishWithLlm(
  raw: string,
  groundedFacts: string,
  language: string,
  maxLength: number,
): Promise<string> {
  const system = `You are a copy editor for Indian real estate WhatsApp messages.
Rules:
- Output ONLY the polished message text.
- Language: ${language}.
- Max ${maxLength} characters.
- Use WhatsApp formatting: *bold*, _italic_ sparingly.
- Do NOT add, remove, or change any factual claims (prices, BHK, areas, dates, discounts, RERA, possession).
- Do NOT invent properties, offers, or numbers.
- Professional, warm tone. One clear call-to-action if present in the original.

GROUNDED FACTS (only facts you may preserve):
${groundedFacts.slice(0, 6000) || '(none provided)'}`;

  const apiKey = config.ai.openaiApiKey || config.ai.kimiApiKey;
  const baseUrl = config.ai.openaiApiKey
    ? 'https://api.openai.com/v1'
    : config.ai.kimiApiBaseUrl;
  const model = config.ai.openaiApiKey ? config.ai.openaiModel : config.ai.kimi25Model;

  const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: raw },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Polish API ${response.status}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content || '').trim();
}
