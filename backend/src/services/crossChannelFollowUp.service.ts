import prisma from '../config/prisma';
import logger from '../config/logger';
import { getConversionSettings } from './conversionSettings.service';
import { emailService } from './email.service';

/**
 * When WhatsApp is blocked/unavailable, attempt email re-engagement if lead has email.
 */
export async function tryCrossChannelFollowUp(
  leadId: string,
  reason: string,
  whatsappBody: string,
): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      companyId: true,
      email: true,
      customerName: true,
    },
  });

  if (!lead?.email?.trim()) {
    return;
  }

  const settings = await getConversionSettings(lead.companyId);
  if (!settings.cross_channel_followup_enabled) {
    return;
  }

  const subject =
    reason.includes('30d')
      ? 'Your personalised market update'
      : reason.includes('7d')
        ? 'Market moved — still interested?'
        : 'New properties matching your search';

  try {
    const sent = await emailService.sendReEngagementEmail({
      toEmail: lead.email.trim(),
      toName: lead.customerName,
      subject,
      bodyText: whatsappBody.replace(/\*/g, ''),
    });

    if (sent) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { lastContactAt: new Date() },
      });
    }
  } catch (err: any) {
    logger.warn('Cross-channel follow-up email failed', {
      leadId,
      error: err?.message,
    });
  }
}
