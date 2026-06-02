import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/prisma';

export interface ConversionPartner {
  id: string;
  name: string;
  contact_phone?: string | null;
  notes?: string | null;
  active: boolean;
}

export interface ConversionWaitlistCopy {
  en: string;
  hi?: string;
  kn?: string;
}

export interface ConversionSettings {
  budget_stretch_percent: number;
  upsell_enabled: boolean;
  waitlist_copy: ConversionWaitlistCopy;
  partners: ConversionPartner[];
}

export type ConversionSettingsPatch = Omit<Partial<ConversionSettings>, 'waitlist_copy'> & {
  waitlist_copy?: Partial<ConversionWaitlistCopy>;
};

const DEFAULT_WAITLIST_COPY: ConversionWaitlistCopy = {
  en: "I'll add you to our priority waitlist and notify you when a matching unit is available.",
  hi: 'मैं आपको प्राथमिकता वेटलिस्ट में जोड़ूंगा और मैच मिलते ही सूचित करूंगा।',
  kn: 'ನಿಮ್ಮನ್ನು ಪ್ರಾಧಾನ್ಯತೆ ವೇಟ್‌ಲಿಸ್ಟ್‌ಗೆ ಸೇರಿಸಿ ಹೊಂದುವ ಯುನಿಟ್ ದೊರೆತಾಗಲೇ ತಿಳಿಸುತ್ತೇನೆ.',
};

export const DEFAULT_CONVERSION_SETTINGS: ConversionSettings = {
  budget_stretch_percent: 15,
  upsell_enabled: true,
  waitlist_copy: DEFAULT_WAITLIST_COPY,
  partners: [],
};

function clampPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONVERSION_SETTINGS.budget_stretch_percent;
  return Math.min(50, Math.max(5, Math.round(n)));
}

function normalizePartner(raw: unknown): ConversionPartner | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const name = String(p.name || '').trim();
  if (!name) return null;
  return {
    id: String(p.id || uuidv4()),
    name,
    contact_phone: p.contact_phone != null ? String(p.contact_phone) : null,
    notes: p.notes != null ? String(p.notes) : null,
    active: p.active !== false,
  };
}

export function parseConversionSettings(settingsJson: unknown): ConversionSettings {
  const root = (settingsJson && typeof settingsJson === 'object' ? settingsJson : {}) as Record<
    string,
    unknown
  >;
  const raw = (root.conversion && typeof root.conversion === 'object'
    ? root.conversion
    : {}) as Record<string, unknown>;

  const waitlistRaw =
    raw.waitlist_copy && typeof raw.waitlist_copy === 'object'
      ? (raw.waitlist_copy as Record<string, string>)
      : {};

  const partners: ConversionPartner[] = Array.isArray(raw.partners)
    ? raw.partners.map(normalizePartner).filter((p): p is ConversionPartner => p !== null)
    : [];

  return {
    budget_stretch_percent: clampPercent(raw.budget_stretch_percent),
    upsell_enabled: raw.upsell_enabled !== false,
    waitlist_copy: {
      en: waitlistRaw.en || DEFAULT_WAITLIST_COPY.en,
      hi: waitlistRaw.hi || DEFAULT_WAITLIST_COPY.hi,
      kn: waitlistRaw.kn || DEFAULT_WAITLIST_COPY.kn,
    },
    partners,
  };
}

export function mergeCompanyConversionSettings(
  companySettings: unknown,
  patch: ConversionSettingsPatch,
): Record<string, unknown> {
  const base =
    companySettings && typeof companySettings === 'object'
      ? { ...(companySettings as Record<string, unknown>) }
      : {};
  const current = parseConversionSettings(base);

  const merged: ConversionSettings = {
    budget_stretch_percent:
      patch.budget_stretch_percent !== undefined
        ? clampPercent(patch.budget_stretch_percent)
        : current.budget_stretch_percent,
    upsell_enabled: patch.upsell_enabled !== undefined ? patch.upsell_enabled : current.upsell_enabled,
    waitlist_copy: patch.waitlist_copy
      ? { ...current.waitlist_copy, ...patch.waitlist_copy }
      : current.waitlist_copy,
    partners: patch.partners !== undefined ? patch.partners : current.partners,
  };

  return { ...base, conversion: merged };
}

export async function getConversionSettings(companyId: string): Promise<ConversionSettings> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  return parseConversionSettings(company?.settings);
}

export async function saveConversionSettings(
  companyId: string,
  patch: ConversionSettingsPatch,
): Promise<ConversionSettings> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  if (!company) {
    throw new Error('Company not found');
  }

  const nextSettings = mergeCompanyConversionSettings(company.settings, patch);
  await prisma.company.update({
    where: { id: companyId },
    data: { settings: nextSettings as object },
  });

  return parseConversionSettings(nextSettings);
}

export function getBudgetStretchRatio(settings: ConversionSettings): number {
  return settings.budget_stretch_percent / 100;
}

export function getWaitlistMessage(settings: ConversionSettings, language?: string | null): string {
  const lang = language || 'en';
  const copy = settings.waitlist_copy;
  return copy[lang as keyof ConversionWaitlistCopy] || copy.en;
}
