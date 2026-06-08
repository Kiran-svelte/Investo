import prisma from '../config/prisma';

/**
 * Single source of truth for whether non-buyer/admin flows may auto-book without agent approval.
 * DB setting wins when explicitly set; otherwise env must explicitly opt in.
 */
export async function isVisitAutoConfirmEnabled(companyId: string): Promise<boolean> {
  const settings = await prisma.aiSetting.findUnique({
    where: { companyId },
    select: { autoConfirmVisits: true },
  });
  if (settings?.autoConfirmVisits === true) return true;
  if (settings?.autoConfirmVisits === false) return false;
  const raw = (process.env.WHATSAPP_AUTO_CONFIRM_VISITS || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}
