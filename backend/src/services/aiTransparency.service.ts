import type { Property } from '@prisma/client';

export type TransparencyConfidence = 'high' | 'medium' | 'low';

export interface TransparencyContext {
  confidence: TransparencyConfidence;
  sources: string[];
  priceUpdatedAt?: Date | null;
  admitsUncertainty?: boolean;
}

function formatPriceUpdated(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

export function inferConfidenceFromProperties(
  propertyCount: number,
  hasExactMatch: boolean,
): TransparencyConfidence {
  if (propertyCount === 0) return 'low';
  if (hasExactMatch && propertyCount >= 1) return 'high';
  if (propertyCount >= 2) return 'medium';
  return 'low';
}

export function buildPropertySources(properties: Pick<Property, 'name' | 'updatedAt'>[]): {
  sources: string[];
  latestPriceUpdate: Date | null;
} {
  const sources = properties.slice(0, 3).map((p) => p.name);
  const latest = properties.reduce<Date | null>((acc, p) => {
    const t = p.updatedAt ? new Date(p.updatedAt) : null;
    if (!t) return acc;
    return !acc || t > acc ? t : acc;
  }, null);
  return { sources, latestPriceUpdate: latest };
}

export function buildTransparencyFooter(ctx: TransparencyContext): string {
  const lines: string[] = [];
  const confLabel =
    ctx.confidence === 'high' ? 'High' : ctx.confidence === 'medium' ? 'Medium' : 'Low';
  lines.push(`Confidence: ${confLabel}`);
  if (ctx.sources.length > 0) {
    lines.push(`Sources: ${ctx.sources.join(', ')}`);
  } else {
    lines.push('Sources: company knowledge base');
  }
  const priceLine = formatPriceUpdated(
    ctx.priceUpdatedAt ? ctx.priceUpdatedAt.toISOString() : null,
  );
  if (priceLine) {
    lines.push(`Price last updated: ${priceLine} IST`);
  }
  if (ctx.admitsUncertainty) {
    lines.push('Note: Some details need agent verification.');
  }
  lines.push('Reply WRONG if any info is incorrect.');
  return `\n\n—\n${lines.join('\n')}`;
}

export function appendTransparencyFooter(message: string, footer: string): string {
  if (!footer.trim()) return message;
  if (message.includes('Reply WRONG')) return message;
  const maxLen = 3900;
  const combined = message + footer;
  if (combined.length <= maxLen) return combined;
  return message.slice(0, maxLen - footer.length) + footer;
}

const INTERNAL_META_LINE =
  /^(Confidence:|Sources:|Price last updated:|Note: Some details need agent verification\.|Reply WRONG if any info is incorrect\.)/i;

/** Removes internal audit footers — never show these to WhatsApp customers. */
export function stripInternalCustomerMeta(message: string): string {
  if (!message.trim()) return message;

  const emDashSplit = message.split(/\n\s*—\s*\n/);
  if (emDashSplit.length > 1) {
    const tail = emDashSplit[emDashSplit.length - 1];
    if (
      /Confidence:/i.test(tail) ||
      /Reply WRONG/i.test(tail) ||
      /Sources:/i.test(tail)
    ) {
      return emDashSplit.slice(0, -1).join('\n\n').trim();
    }
  }

  const lines = message.split('\n');
  const kept: string[] = [];
  let inMetaBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '—' || trimmed === '---') {
      inMetaBlock = true;
      continue;
    }
    if (inMetaBlock) {
      if (INTERNAL_META_LINE.test(trimmed)) continue;
      if (!trimmed) continue;
      inMetaBlock = false;
    }
    if (INTERNAL_META_LINE.test(trimmed)) continue;
    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
