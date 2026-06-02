import type { PropertyLike } from './propertyCompleteness.service';

/**
 * Builds allowlisted numeric tokens from grounded property rows and conversion text.
 */
export function buildGroundedNumberAllowlist(
  properties: PropertyLike[],
  extraGroundedText?: string,
): Set<string> {
  const allow = new Set<string>();

  const addNum = (n: number | null) => {
    if (n === null || Number.isNaN(n)) return;
    allow.add(String(Math.round(n)));
    allow.add(String(n));
    if (n >= 100000) {
      allow.add(String(Math.round(n / 100000)));
      allow.add((n / 10000000).toFixed(1));
    }
  };

  for (const p of properties) {
    addNum(toNum(p.priceMin));
    addNum(toNum(p.priceMax));
    if (p.bedrooms != null) allow.add(String(p.bedrooms));
  }

  if (extraGroundedText) {
    const nums = extraGroundedText.match(/[\d][\d,.]*[\d]|[\d]+/g) || [];
    for (const token of nums) {
      allow.add(token.replace(/,/g, ''));
      const bare = parseFloat(token.replace(/,/g, ''));
      if (!Number.isNaN(bare)) addNum(bare);
    }
  }

  return allow;
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function numberTokenAllowed(token: string, allowlist: Set<string>): boolean {
  const normalized = token.replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!normalized) return true;
  if (allowlist.has(normalized)) return true;
  const n = parseFloat(normalized);
  if (Number.isNaN(n)) return true;
  for (const allowed of allowlist) {
    const a = parseFloat(allowed);
    if (!Number.isNaN(a) && Math.abs(a - n) / Math.max(a, 1) < 0.02) return true;
  }
  return false;
}

export interface GroundingGuardResult {
  text: string;
  guardApplied: boolean;
}

/**
 * Strips or softens ungrounded discounts, ROI, possession dates, and currency amounts.
 */
export function stripUngroundedClaims(
  text: string,
  allowlist: Set<string>,
): GroundingGuardResult {
  let out = text;
  let guardApplied = false;

  // Ungrounded discount percentages
  out = out.replace(/\b(\d{1,2})\s*%\s*(off|discount|less|savings?)/gi, (match, pct: string) => {
    if (numberTokenAllowed(pct, allowlist)) return match;
    guardApplied = true;
    return 'a promotional offer (confirm on visit)';
  });

  // ROI / returns not in data
  if (/\b\d{1,2}\s*%\s*(roi|return|yield|appreciation)/i.test(out)) {
    const roiMatch = out.match(/\b(\d{1,2})\s*%\s*(roi|return|yield|appreciation)/i);
    if (roiMatch && !numberTokenAllowed(roiMatch[1], allowlist)) {
      out = out.replace(/\b\d{1,2}\s*%\s*(roi|return|yield|appreciation)/gi, 'returns (confirm with our team)');
      guardApplied = true;
    }
  }

  // Possession / handover dates (Q1 2025, Dec 2026, etc.) — soften unless allowlisted year appears in block
  if (/\b(possession|handover|ready by|completion)\b[^.?\n]{0,40}\b(20\d{2}|Q[1-4]\s*20\d{2})/i.test(out)) {
    const yearInAllow = [...allowlist].some((t) => /^20\d{2}$/.test(t));
    if (!yearInAllow) {
      out = out.replace(
        /\b((?:possession|handover|ready by|completion)[^.?\n]{0,40}\b(?:20\d{2}|Q[1-4]\s*20\d{2}[^.?\n]*))/gi,
        'possession timeline (confirm on visit)',
      );
      guardApplied = true;
    }
  }

  // ₹ amounts not near allowlisted values
  out = out.replace(/₹\s*([\d,.]+)\s*([LKCr]{1,2})?/gi, (match, numPart: string) => {
    const core = numPart.replace(/,/g, '');
    if (numberTokenAllowed(core, allowlist)) return match;
    guardApplied = true;
    return '₹[price on visit]';
  });

  return { text: out.trim(), guardApplied };
}

export function buildGroundedFactsBlock(
  properties: PropertyLike[],
  conversionPromptBlock?: string,
): string {
  const lines = properties.map((p) => {
    const min = toNum(p.priceMin);
    const max = toNum(p.priceMax);
    const price =
      min && max ? `₹${min}-${max}` : min ? `₹${min}+` : max ? `up to ₹${max}` : 'price TBC';
    return `- ${p.name || 'Property'} | ${p.locationArea || ''}, ${p.locationCity || ''} | ${p.bedrooms ?? '?'}BHK ${p.propertyType || ''} | ${price}`;
  });

  const block = ['## GROUNDED PROPERTY FACTS', ...lines];
  if (conversionPromptBlock) {
    block.push('', conversionPromptBlock);
  }
  return block.join('\n');
}
