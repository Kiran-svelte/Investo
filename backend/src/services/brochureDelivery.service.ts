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
  /\b(brochure|brochures|pdf|broucher|details\s*pdf|document)\b|\b(send|share)\b[\s\S]{0,40}\b(brochure|pdf|document)\b/i;

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

/** Presigned HTTPS URL for property hero images (private S3/R2 buckets). */
export async function resolvePropertyImageUrlForWhatsApp(storedUrl: string): Promise<string | null> {
  return resolveBrochureUrlForWhatsApp(storedUrl);
}

export type WhatsAppMediaComponent = {
  kind: 'media';
  url: string;
  mime: string;
  caption?: string;
};

/** First fetchable hero image from a property images JSON array. */
export async function resolveFirstPropertyHeroMediaComponent(input: {
  images: unknown;
  caption?: string;
}): Promise<WhatsAppMediaComponent | null> {
  if (!Array.isArray(input.images)) return null;

  for (const raw of input.images) {
    if (typeof raw !== 'string' || !raw.trim()) continue;

    const presigned = await resolvePropertyImageUrlForWhatsApp(raw);
    if (presigned) {
      const mime = /\.png(?:\?|$)/i.test(raw) ? 'image/png' : 'image/jpeg';
      return { kind: 'media', url: presigned, mime, caption: input.caption };
    }

    if (raw.startsWith('https://')) {
      const mime = /\.png(?:\?|$)/i.test(raw) ? 'image/png' : 'image/jpeg';
      return { kind: 'media', url: raw, mime, caption: input.caption };
    }
  }

  return null;
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

/**
 * Pure brochure resolution — strips brochure links from `aiText` and returns an
 * optional WhatsApp media component for the orchestrator to include in `TurnResult`.
 *
 * **Does NOT send anything.** The media component is dispatched later via
 * `sendTurnResult`, keeping all outbound sends in one place.
 *
 * @returns `cleanedText` — `aiText` with embedded brochure URLs removed.
 * @returns `mediaComponent` — a `{ kind: 'media' }` component when a brochure should be
 *   delivered this turn, or `null` when no brochure intent is detected.
 */
export async function resolveBrochureForAiTurn(input: {
  customerMessage: string;
  aiText: string;
  properties: PropertyBrochureSource[];
}): Promise<{
  cleanedText: string;
  mediaComponent: { kind: 'media'; url: string; mime: string; caption?: string } | null;
}> {
  const targets = selectPropertiesForBrochureDelivery({
    customerMessage: input.customerMessage,
    aiText: input.aiText,
    properties: input.properties,
  });

  const proactive = selectPropertiesForProactiveShortlist({
    aiText: input.aiText,
    properties: input.properties,
  });

  const chosen = targets[0] ?? proactive[0];
  const cleanedText = stripBrochureLinksFromText(input.aiText);

  if (!chosen?.brochureUrl) {
    return { cleanedText, mediaComponent: null };
  }

  const publicUrl = await resolveBrochureUrlForWhatsApp(chosen.brochureUrl);
  if (!publicUrl) {
    logger.warn('resolveBrochureForAiTurn: could not resolve presigned URL', {
      propertyId: chosen.id,
    });
    return { cleanedText, mediaComponent: null };
  }

  return {
    cleanedText,
    mediaComponent: {
      kind: 'media',
      url: publicUrl,
      mime: 'application/pdf',
      caption: `📎 ${chosen.name} — Brochure`,
    },
  };
}

/** When AI discusses exactly one property, proactively attach brochure (no explicit ask). */
export function selectPropertiesForProactiveShortlist(input: {
  aiText: string;
  properties: PropertyBrochureSource[];
}): PropertyBrochureSource[] {
  const withBrochure = input.properties.filter((p) => p.brochureUrl);
  if (!withBrochure.length) return [];

  const mentioned = withBrochure.filter((p) => {
    const name = normalizeName(p.name);
    return name.length >= 3 && normalizeName(input.aiText).includes(name);
  });

  if (mentioned.length === 1) return [mentioned[0]];
  if (withBrochure.length === 1 && input.aiText.length > 40) return [withBrochure[0]];
  return [];
}
