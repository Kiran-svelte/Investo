import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import {
  SUBSCRIPTION_PRICING,
  BILLABLE_USER_ROLES,
} from '../../constants/subscriptionPricing';
import type { BillingStatus, SubscriptionPaymentMethod } from '@prisma/client';

export type SubscriptionSummary = {
  billingStatus: BillingStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  paymentMethod: SubscriptionPaymentMethod | null;
  basePriceMonthly: number;
  negotiatedMonthlyPrice: number | null;
  includedSeats: number;
  perSeatPriceInr: number;
  seatCount: number;
  extraSeats: number;
  monthlyTotal: number;
  nextBillingDate: string | null;
  hasAccess: boolean;
  isTrial: boolean;
  needsPayment: boolean;
};

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

export function computeMonthlyTotal(input: {
  basePriceMonthly: number;
  negotiatedMonthlyPrice?: number | null;
  includedSeats: number;
  perSeatPriceInr: number;
  seatCount: number;
}): { extraSeats: number; monthlyTotal: number; effectiveBase: number } {
  const effectiveBase = input.negotiatedMonthlyPrice ?? input.basePriceMonthly;
  const extraSeats = Math.max(0, input.seatCount - input.includedSeats);
  const monthlyTotal = effectiveBase + extraSeats * input.perSeatPriceInr;
  return { extraSeats, monthlyTotal, effectiveBase };
}

export async function countBillableSeats(companyId: string): Promise<number> {
  return prisma.user.count({
    where: {
      companyId,
      status: 'active',
      role: { in: [...BILLABLE_USER_ROLES] },
    },
  });
}

/**
 * Determines whether a company currently has platform access.
 *
 * Enforces trial expiry independently of the billing cron — if trialEndsAt has
 * passed, access is denied even if billingStatus is still 'trialing'. This is a
 * safety net for when the cron job misses a run or is delayed.
 *
 * @param billingStatus - Current subscription billing status.
 * @param graceUntil - Grace period end date for past_due accounts, or null.
 * @param companyStatus - Company-level status ('active', 'suspended', etc.).
 * @param trialEndsAt - Trial expiry date, required when billingStatus is 'trialing'.
 * @returns true if the company has access to the platform.
 */
export function resolveHasAccess(
  billingStatus: BillingStatus,
  graceUntil: Date | null,
  companyStatus: string,
  trialEndsAt?: Date | null,
): boolean {
  if (companyStatus === 'suspended') return false;
  if (billingStatus === 'trialing') {
    // Independently enforce trial expiry — do not wait for billing cron to flip status.
    if (trialEndsAt && trialEndsAt.getTime() <= Date.now()) return false;
    return true;
  }
  if (billingStatus === 'active') return true;
  if (billingStatus === 'past_due') {
    if (graceUntil && graceUntil.getTime() > Date.now()) return true;
    return false;
  }
  return false;
}


export function buildSubscriptionSummary(
  sub: {
    billingStatus: BillingStatus;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    graceUntil: Date | null;
    paymentMethod: SubscriptionPaymentMethod | null;
    basePriceMonthly: Prisma.Decimal;
    negotiatedMonthlyPrice: Prisma.Decimal | null;
    includedSeats: number;
    perSeatPriceInr: Prisma.Decimal;
    nextBillingDate: Date | null;
  },
  seatCount: number,
  companyStatus: string,
): SubscriptionSummary {
  const basePriceMonthly = toNumber(sub.basePriceMonthly);
  const negotiatedMonthlyPrice = sub.negotiatedMonthlyPrice
    ? toNumber(sub.negotiatedMonthlyPrice)
    : null;
  const perSeatPriceInr = toNumber(sub.perSeatPriceInr);
  const { extraSeats, monthlyTotal } = computeMonthlyTotal({
    basePriceMonthly,
    negotiatedMonthlyPrice,
    includedSeats: sub.includedSeats,
    perSeatPriceInr,
    seatCount,
  });

  let trialDaysRemaining: number | null = null;
  if (sub.billingStatus === 'trialing' && sub.trialEndsAt) {
    trialDaysRemaining = Math.max(
      0,
      Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
  }

  const hasAccess = resolveHasAccess(sub.billingStatus, sub.graceUntil, companyStatus, sub.trialEndsAt);
  const needsPayment =
    sub.billingStatus === 'trialing' &&
    sub.trialEndsAt != null &&
    sub.trialEndsAt.getTime() <= Date.now();

  return {
    billingStatus: sub.billingStatus,
    trialStartedAt: sub.trialStartedAt?.toISOString() ?? null,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    trialDaysRemaining,
    currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    graceUntil: sub.graceUntil?.toISOString() ?? null,
    paymentMethod: sub.paymentMethod,
    basePriceMonthly,
    negotiatedMonthlyPrice,
    includedSeats: sub.includedSeats,
    perSeatPriceInr,
    seatCount,
    extraSeats,
    monthlyTotal,
    nextBillingDate: sub.nextBillingDate?.toISOString() ?? null,
    hasAccess,
    isTrial: sub.billingStatus === 'trialing',
    needsPayment,
  };
}

export async function getSubscriptionSummary(companyId: string): Promise<SubscriptionSummary | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { status: true, subscription: true },
  });
  if (!company?.subscription) return null;

  const seatCount = await countBillableSeats(companyId);
  return buildSubscriptionSummary(company.subscription, seatCount, company.status);
}

export async function startTrialForCompany(
  companyId: string,
  options?: { negotiatedMonthlyPrice?: number | null },
): Promise<void> {
  const existing = await prisma.companySubscription.findUnique({ where: { companyId } });
  if (existing) return;

  const now = new Date();
  const trialEnds = new Date(now);
  trialEnds.setDate(trialEnds.getDate() + SUBSCRIPTION_PRICING.trialDays);

  await prisma.companySubscription.create({
    data: {
      companyId,
      billingStatus: 'trialing',
      trialStartedAt: now,
      trialEndsAt: trialEnds,
      basePriceMonthly: SUBSCRIPTION_PRICING.basePriceMonthlyInr,
      includedSeats: SUBSCRIPTION_PRICING.includedSeats,
      perSeatPriceInr: SUBSCRIPTION_PRICING.perSeatPriceInr,
      ...(options?.negotiatedMonthlyPrice != null
        ? { negotiatedMonthlyPrice: options.negotiatedMonthlyPrice }
        : {}),
    },
  });

  await logBillingEvent(companyId, 'trial_started', { trialEndsAt: trialEnds.toISOString() });
  logger.info('Subscription trial started', { companyId, trialEndsAt: trialEnds.toISOString() });
}

export async function activateSubscription(
  companyId: string,
  paymentMethod: SubscriptionPaymentMethod,
  options?: { cashfreeSubscriptionId?: string; cashfreeCustomerId?: string },
): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await prisma.$transaction([
    prisma.companySubscription.update({
      where: { companyId },
      data: {
        billingStatus: 'active',
        paymentMethod,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        graceUntil: null,
        suspendedAt: null,
        ...(options?.cashfreeSubscriptionId
          ? { cashfreeSubscriptionId: options.cashfreeSubscriptionId }
          : {}),
        ...(options?.cashfreeCustomerId ? { cashfreeCustomerId: options.cashfreeCustomerId } : {}),
      },
    }),
    prisma.company.update({
      where: { id: companyId },
      data: { status: 'active' },
    }),
  ]);

  await logBillingEvent(companyId, 'subscription_activated', { paymentMethod });
}

export async function markPastDue(companyId: string): Promise<void> {
  const graceUntil = new Date();
  graceUntil.setDate(graceUntil.getDate() + SUBSCRIPTION_PRICING.gracePeriodDays);

  await prisma.companySubscription.update({
    where: { companyId },
    data: { billingStatus: 'past_due', graceUntil },
  });

  await logBillingEvent(companyId, 'past_due', { graceUntil: graceUntil.toISOString() });
}

export async function suspendForNonPayment(companyId: string): Promise<void> {
  await prisma.$transaction([
    prisma.companySubscription.update({
      where: { companyId },
      data: { billingStatus: 'suspended', suspendedAt: new Date() },
    }),
    prisma.company.update({
      where: { id: companyId },
      data: { status: 'suspended' },
    }),
  ]);

  await logBillingEvent(companyId, 'suspended_non_payment', {});
}

export async function logBillingEvent(
  companyId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await prisma.billingEvent.create({
    data: { companyId, eventType, payload: payload as object },
  });
}

export async function ensureInvestoProPlan(): Promise<string> {
  const existing = await prisma.subscriptionPlan.findFirst({
    where: { name: SUBSCRIPTION_PRICING.planName },
    select: { id: true },
  });
  if (existing) {
    await prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: {
        maxAgents: SUBSCRIPTION_PRICING.includedSeats,
        maxLeads: null,
        maxProperties: null,
        priceMonthly: SUBSCRIPTION_PRICING.basePriceMonthlyInr,
        priceYearly: SUBSCRIPTION_PRICING.basePriceMonthlyInr * 12,
        features: ['whatsapp_ai', 'advanced_crm', 'calendar', 'analytics', 'automation', 'copilot'],
        status: 'active',
      },
    });
    return existing.id;
  }

  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: SUBSCRIPTION_PRICING.planName,
      maxAgents: SUBSCRIPTION_PRICING.includedSeats,
      maxLeads: null,
      maxProperties: null,
      priceMonthly: SUBSCRIPTION_PRICING.basePriceMonthlyInr,
      priceYearly: SUBSCRIPTION_PRICING.basePriceMonthlyInr * 12,
      features: ['whatsapp_ai', 'advanced_crm', 'calendar', 'analytics', 'automation', 'copilot'],
      status: 'active',
    },
  });
  return plan.id;
}

export async function assignInvestoProPlan(companyId: string): Promise<void> {
  const planId = await ensureInvestoProPlan();
  await prisma.company.update({
    where: { id: companyId },
    data: { planId },
  });
}
