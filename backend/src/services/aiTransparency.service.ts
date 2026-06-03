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
