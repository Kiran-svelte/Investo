import prisma from '../../config/prisma';
import config from '../../config';
import logger from '../../config/logger';
import type { SubscriptionPaymentMethod } from '@prisma/client';
import {
  createCashfreeOrder,
  fetchCashfreeOrder,
  generateOrderId,
  isCashfreeConfigured,
} from './cashfree.service';
import {
  activateSubscription,
  countBillableSeats,
  computeMonthlyTotal,
  getSubscriptionSummary,
  logBillingEvent,
} from './subscription.service';
import { generateSubscriptionInvoice, markInvoicePaid } from './invoiceGenerator.service';

export type CheckoutInput = {
  companyId: string;
  method: SubscriptionPaymentMethod;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
};

export type CheckoutResult = {
  paymentId: string;
  orderId?: string;
  checkoutUrl?: string;
  devMode?: boolean;
  invoiceId?: string;
  instructions?: string;
  amount: number;
};

export async function initiateCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const sub = await prisma.companySubscription.findUnique({ where: { companyId: input.companyId } });
  if (!sub) throw new Error('No subscription found');

  const seatCount = await countBillableSeats(input.companyId);
  const { monthlyTotal } = computeMonthlyTotal({
    basePriceMonthly: Number(sub.basePriceMonthly),
    negotiatedMonthlyPrice: sub.negotiatedMonthlyPrice ? Number(sub.negotiatedMonthlyPrice) : null,
    includedSeats: sub.includedSeats,
    perSeatPriceInr: Number(sub.perSeatPriceInr),
    seatCount,
  });

  if (input.method === 'invoice') {
    const invoiceId = await generateSubscriptionInvoice(input.companyId);
    const payment = await prisma.payment.create({
      data: {
        companyId: input.companyId,
        subscriptionId: sub.id,
        invoiceId,
        amount: monthlyTotal,
        status: 'pending',
        method: 'invoice',
        metadata: {
          netDays: 30,
          awaitingPayment: true,
          resolutionId: 'INVESTO-20260629-PAYMENT-LOCKOUT',
        },
      },
    });

    await logBillingEvent(input.companyId, 'checkout_invoice_requested', {
      invoiceId,
      paymentId: payment.id,
      resolutionId: 'INVESTO-20260629-PAYMENT-LOCKOUT',
    });

    return {
      paymentId: payment.id,
      invoiceId,
      amount: monthlyTotal,
      instructions:
        'Invoice generated with Net 30 terms. Access resumes after payment is received and confirmed.',
    };
  }

  if (input.method === 'bank_transfer') {
    const invoiceId = await generateSubscriptionInvoice(input.companyId);
    const payment = await prisma.payment.create({
      data: {
        companyId: input.companyId,
        subscriptionId: sub.id,
        invoiceId,
        amount: monthlyTotal,
        status: 'pending',
        method: 'bank_transfer',
        metadata: { awaitingTransfer: true, resolutionId: 'INVESTO-20260629-PAYMENT-LOCKOUT' },
      },
    });

    return {
      paymentId: payment.id,
      invoiceId,
      amount: monthlyTotal,
      instructions:
        'Transfer the amount to our bank account (details on invoice). Share UTR with support@investo.in. Account activates once payment is confirmed.',
    };
  }

  const orderId = generateOrderId(input.companyId);
  const invoiceId = await generateSubscriptionInvoice(input.companyId);

  const returnUrl = `${config.frontend.baseUrl}/dashboard/billing?order_id=${encodeURIComponent(orderId)}`;
  const notifyUrl = `${config.apiPublicUrl}/api/webhooks/cashfree`;

  const paymentMethods =
    input.method === 'upi' ? (['upi'] as const) : input.method === 'card' ? (['card'] as const) : undefined;

  const order = await createCashfreeOrder({
    orderId,
    amountInr: monthlyTotal,
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    returnUrl,
    notifyUrl,
    paymentMethods: paymentMethods ? [...paymentMethods] : ['card', 'upi', 'nb'],
  });

  const payment = await prisma.payment.create({
    data: {
      companyId: input.companyId,
      subscriptionId: sub.id,
      invoiceId,
      amount: monthlyTotal,
      status: 'pending',
      method: input.method,
      cashfreeOrderId: order.orderId,
      metadata: { paymentSessionId: order.paymentSessionId, devMode: order.devMode },
    },
  });

  return {
    paymentId: payment.id,
    orderId: order.orderId,
    checkoutUrl: order.checkoutUrl,
    devMode: order.devMode,
    invoiceId,
    amount: monthlyTotal,
  };
}

export async function confirmPayment(orderId: string, companyId: string): Promise<boolean> {
  const payment = await prisma.payment.findFirst({
    where: { cashfreeOrderId: orderId, companyId },
  });
  if (!payment) return false;
  if (payment.status === 'success') return true;

  const isDevMode =
    !isCashfreeConfigured() ||
    (typeof payment.metadata === 'object' &&
      payment.metadata !== null &&
      (payment.metadata as { devMode?: boolean }).devMode === true);

  let success = false;
  let paymentRef = orderId;

  if (isDevMode) {
    success = true;
    paymentRef = `DEV-${orderId}`;
  } else {
    const order = await fetchCashfreeOrder(orderId);
    success = order.status === 'PAID' || order.status === 'ACTIVE';
    if (order.paymentId) paymentRef = order.paymentId;
  }

  if (!success) return false;

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'success',
      paidAt: new Date(),
      cashfreePaymentId: paymentRef,
    },
  });

  if (payment.invoiceId) {
    await markInvoicePaid(payment.invoiceId, paymentRef, payment.method);
  }

  await activateSubscription(companyId, payment.method);
  await logBillingEvent(companyId, 'payment_success', { orderId, paymentId: payment.id });

  return true;
}

/**
 * Processes a Cashfree payment success webhook event.
 * Uses atomic updateMany (WHERE status = 'pending') to prevent double-processing
 * when Cashfree delivers the same webhook event more than once concurrently.
 *
 * @param orderId - Cashfree order ID from the webhook payload.
 * @param paymentId - Cashfree payment ID (cf_payment_id), if available.
 */
export async function handleCashfreeWebhook(orderId: string, paymentId?: string): Promise<void> {
  // Atomic claim: only one concurrent call can set status=success.
  // If rowCount === 0, this webhook was already processed — safe to ignore.
  const result = await prisma.payment.updateMany({
    where: { cashfreeOrderId: orderId, status: { not: 'success' } },
    data: {
      status: 'success',
      paidAt: new Date(),
      cashfreePaymentId: paymentId || orderId,
    },
  });

  if (result.count === 0) {
    logger.info('handleCashfreeWebhook: duplicate delivery or already processed, skipping', { orderId });
    return;
  }

  const payment = await prisma.payment.findFirst({ where: { cashfreeOrderId: orderId } });
  if (!payment) {
    logger.error('handleCashfreeWebhook: payment row missing after successful update — data inconsistency', { orderId });
    return;
  }

  if (payment.invoiceId) {
    await markInvoicePaid(payment.invoiceId, paymentId || orderId, payment.method);
  }

  await activateSubscription(payment.companyId, payment.method);
  await logBillingEvent(payment.companyId, 'webhook_payment_success', { orderId });
}


export { getSubscriptionSummary };
