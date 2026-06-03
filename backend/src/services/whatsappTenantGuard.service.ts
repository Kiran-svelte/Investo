import prisma from '../config/prisma';
import { phoneLast10 } from '../utils/phoneMatch';

function extractMetaPhoneNumberId(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const whatsapp = (settings as Record<string, unknown>).whatsapp;
  if (!whatsapp || typeof whatsapp !== 'object' || Array.isArray(whatsapp)) return null;
  const wa = whatsapp as Record<string, unknown>;
  const meta = (wa.meta && typeof wa.meta === 'object' ? wa.meta : wa) as Record<string, unknown>;
  const id = meta.phoneNumberId || meta.phone_number_id || wa.phoneNumberId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/**
 * Prevent two tenants from sharing the same Meta Phone Number ID (breaks inbound routing).
 */
export async function assertUniqueMetaPhoneNumberId(
  companyId: string,
  mergedSettings: unknown,
): Promise<string | null> {
  const phoneNumberId = extractMetaPhoneNumberId(mergedSettings);
  if (!phoneNumberId) return null;

  const companies = await prisma.company.findMany({
    where: { status: 'active', NOT: { id: companyId } },
    select: { id: true, name: true, settings: true },
  });

  for (const other of companies) {
    const otherId = extractMetaPhoneNumberId(other.settings);
    if (otherId && otherId === phoneNumberId) {
      return `Meta Phone Number ID is already linked to company "${other.name}". Remove it there first or use a dedicated WhatsApp line per company.`;
    }
  }

  return null;
}

export function companyMatchesDisplayPhone(
  company: { whatsappPhone?: string | null },
  displayPhoneHint?: string,
): boolean {
  if (!displayPhoneHint || !company.whatsappPhone) return false;
  return phoneLast10(company.whatsappPhone) === phoneLast10(displayPhoneHint);
}
