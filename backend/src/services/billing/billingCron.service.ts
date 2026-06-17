import prisma from '../../config/prisma';
import config from '../../config';
import logger from '../../config/logger';
import { SUBSCRIPTION_PRICING } from '../../constants/subscriptionPricing';
import { emailService } from '../email.service';
import {
  getSubscriptionSummary,
  markPastDue,
  suspendForNonPayment,
  logBillingEvent,
} from './subscription.service';
import { markOverdueInvoices } from './invoiceGenerator.service';

export async function processTrialReminders(): Promise<number> {
  if (!config.features.billing) return 0;

  const trialing = await prisma.companySubscription.findMany({
    where: { billingStatus: 'trialing', trialEndsAt: { not: null } },
    include: { company: { select: { name: true } } },
  });

  let sent = 0;
  for (const sub of trialing) {
    if (!sub.trialEndsAt) continue;
    const daysLeft = Math.ceil(
      (sub.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );

    for (const reminderDay of SUBSCRIPTION_PRICING.trialReminderDays) {
      if (daysLeft !== reminderDay) continue;
      if (sub.lastTrialReminderDay === reminderDay) continue;

      const admin = await prisma.user.findFirst({
        where: { companyId: sub.companyId, role: 'company_admin', status: 'active' },
        select: { email: true, name: true },
      });
      if (!admin?.email) continue;

      await emailService.sendTrialReminderEmail({
        toEmail: admin.email,
        toName: admin.name,
        companyName: sub.company.name,
        daysLeft: reminderDay,
        billingUrl: `${config.frontend.baseUrl}/dashboard/billing`,
      });

      await prisma.companySubscription.update({
        where: { id: sub.id },
        data: { lastTrialReminderDay: reminderDay },
      });
      sent += 1;
    }
  }
  return sent;
}

export async function processExpiredTrials(): Promise<number> {
  if (!config.features.billing) return 0;

  const now = new Date();
  const expired = await prisma.companySubscription.findMany({
    where: {
      billingStatus: 'trialing',
      trialEndsAt: { lte: now },
    },
  });

  for (const sub of expired) {
    await markPastDue(sub.companyId);
    await logBillingEvent(sub.companyId, 'trial_expired', {});

    const admin = await prisma.user.findFirst({
      where: { companyId: sub.companyId, role: 'company_admin', status: 'active' },
      select: { email: true, name: true },
    });
    if (admin?.email) {
      await emailService.sendTrialExpiredEmail({
        toEmail: admin.email,
        toName: admin.name,
        billingUrl: `${config.frontend.baseUrl}/dashboard/billing`,
      });
    }
  }

  return expired.length;
}

export async function processDunningAndSuspension(): Promise<{ pastDue: number; suspended: number }> {
  if (!config.features.billing) return { pastDue: 0, suspended: 0 };

  await markOverdueInvoices();

  const now = new Date();
  let suspended = 0;

  const pastDueSubs = await prisma.companySubscription.findMany({
    where: { billingStatus: 'past_due' },
  });

  for (const sub of pastDueSubs) {
    if (sub.graceUntil && sub.graceUntil.getTime() <= now.getTime()) {
      await suspendForNonPayment(sub.companyId);
      suspended += 1;

      const admin = await prisma.user.findFirst({
        where: { companyId: sub.companyId, role: 'company_admin', status: 'active' },
        select: { email: true, name: true },
      });
      if (admin?.email) {
        await emailService.sendAccountSuspendedEmail({
          toEmail: admin.email,
          toName: admin.name,
          billingUrl: `${config.frontend.baseUrl}/dashboard/billing`,
        });
      }
    }
  }

  return { pastDue: pastDueSubs.length, suspended };
}

export async function runBillingCronJobs(): Promise<void> {
  try {
    const reminders = await processTrialReminders();
    const expired = await processExpiredTrials();
    const dunning = await processDunningAndSuspension();
    if (reminders || expired || dunning.suspended) {
      logger.info('Billing cron completed', { reminders, expired, ...dunning });
    }
  } catch (err) {
    logger.error('Billing cron failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
