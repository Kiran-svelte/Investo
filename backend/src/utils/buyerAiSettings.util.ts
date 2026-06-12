import prisma from '../config/prisma';

/** Fields required for buyer greeting fast paths — always include greetingTemplate. */
export const BUYER_AI_SETTING_SELECT = {
  greetingTemplate: true,
  defaultLanguage: true,
} as const;

export type BuyerAiSettingsRecord = {
  greetingTemplate: string | null;
  defaultLanguage: string | null;
} | null;

export async function loadBuyerAiSettings(companyId: string): Promise<BuyerAiSettingsRecord> {
  return prisma.aiSetting.findUnique({
    where: { companyId },
    select: BUYER_AI_SETTING_SELECT,
  });
}
