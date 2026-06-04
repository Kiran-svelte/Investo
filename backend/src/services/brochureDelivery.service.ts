import logger from '../config/logger';
import { storageService } from './storage.service';
import { extractAwsObjectKeyFromReference } from './storageTargets';
import type { WhatsAppService } from './whatsapp.service';
import type { CompanyWhatsAppConfig } from './whatsapp.service';

export type PropertyBrochureSource = {
  id: string;
  name: string;
  brochureUrl: string | null;
};

const BROCHURE_INTENT =
  /\b(brochure|brochures|pdf|broucher|details\s*pdf|send\s+me|share|document)\b/i;

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi;
const BARE_PDF_URL_RE = /https?:\/\/[^\s)\]]+\.pdf[^\s)\]]*/gi;

/**
 * HTTPS URL WhatsApp can fetch (presigned when bucket is private).
 */
export async function resolveBrochureUrlForWhatsApp(storedUrl: string): Promise<string | null> {
  if (!storedUrl?.trim()) return null;

  try {
    return await storageService.getPresignedDownloadUrl(storedUrl, 3600);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Could not resolve brochure download URL', { error: message });
    return null;
  }
}

export function stripBrochureLinksFromText(text: string): string {
  let cleaned = text;

  cleaned = cleaned.replace(MARKDOWN_LINK_RE, (full, label, url) => {
    if (/\/brochure\/|\.pdf/i.test(url) || /brochure/i.test(label)) {
      return '';
    }
    return full;
  });

  cleaned = cleaned.replace(BARE_PDF_URL_RE, (url) => {
    if (/\/brochure\/|amazonaws\.com|s3\./i.test(url)) {
      return '';
    }
    return url;
  });

  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return cleaned;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function scorePropertyMatch(query: string, property: PropertyBrochureSource): number {
  const q = normalizeName(query);
  const name = normalizeName(property.name);
  if (!name || name.length < 3) return 0;
  if (q.includes(name)) return 10;
  const tokens = name.split(' ').filter((t) => t.length > 2);
  return tokens.reduce((acc, t) => (q.includes(t) ? acc + 2 : acc), 0);
}

export function selectPropertiesForBrochureDelivery(input: {
  customerMessage: string;
  aiText: string;
  properties: PropertyBrochureSource[];
}): PropertyBrochureSource[] {
  const combined = `${input.customerMessage}\n${input.aiText}`;
  if (!BROCHURE_INTENT.test(combined)) {
    return [];
  }

  const withBrochure = input.properties.filter((p) => p.brochureUrl);
  if (withBrochure.length === 0) return [];

  const scored = withBrochure
    .map((p) => ({ p, score: scorePropertyMatch(combined, p) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return [scored[0].p];
  }

  if (BROCHURE_INTENT.test(input.customerMessage)) {
    return [withBrochure[0]];
  }

  return [];
}

export async function deliverBrochuresForAiTurn(input: {
  customerPhone: string;
  customerMessage: string;
  aiText: string;
  properties: PropertyBrochureSource[];
  whatsappConfig: CompanyWhatsAppConfig;
  whatsappService: WhatsAppService;
}): Promise<{ cleanedText: string; sent: string[]; failed: string[] }> {
  const targets = selectPropertiesForBrochureDelivery(input);
  const sent: string[] = [];
  const failed: string[] = [];

  for (const property of targets) {
    const result = await input.whatsappService.sendPropertyBrochure(
      input.customerPhone,
      property.brochureUrl!,
      property.name,
      input.whatsappConfig,
    );

    if (result.success) {
      sent.push(property.name);
    } else {
      failed.push(property.name);
      logger.warn('Brochure PDF send failed', {
        propertyId: property.id,
        error: result.error,
      });
    }
  }

  let cleanedText = stripBrochureLinksFromText(input.aiText);
  if (sent.length > 0) {
    const note =
      sent.length === 1
        ? `📎 I've sent the *${sent[0]}* brochure as a PDF in this chat.`
        : `📎 I've sent brochures as PDF files: ${sent.map((n) => `*${n}*`).join(', ')}.`;
    if (!cleanedText.includes('sent') || !/pdf|brochure/i.test(cleanedText)) {
      cleanedText = cleanedText ? `${cleanedText}\n\n${note}` : note;
    }
  } else if (failed.length > 0 && BROCHURE_INTENT.test(input.customerMessage)) {
    const sorry = `Sorry — I couldn't attach the brochure PDF right now. Our team will share it shortly.`;
    if (!cleanedText.toLowerCase().includes('couldn')) {
      cleanedText = cleanedText ? `${cleanedText}\n\n${sorry}` : sorry;
    }
  }

  return { cleanedText, sent, failed };
}
