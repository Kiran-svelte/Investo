import prisma from '../config/prisma';

/**
 * Single source of truth for whether buyer visit slots auto-book without agent approval.
 * DB setting wins when explicitly set; otherwise falls back to env (default: auto-confirm on).
 */
export async function isVisitAutoConfirmEnabled(companyId: string): Promise<boolean> {
  const settings = await prisma.aiSetting.findUnique({
    where: { companyId },
    select: { autoConfirmVisits: true },
  });
  if (settings?.autoConfirmVisits === true) return true;
  if (settings?.autoConfirmVisits === false) return false;
  return process.env.WHATSAPP_AUTO_CONFIRM_VISITS !== '0';
}
