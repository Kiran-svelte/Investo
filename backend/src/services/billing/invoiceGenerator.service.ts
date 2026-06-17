import prisma from '../../config/prisma';
import { SUBSCRIPTION_PRICING } from '../../constants/subscriptionPricing';
import {
  computeMonthlyTotal,
  countBillableSeats,
  logBillingEvent,
} from './subscription.service';

function padInvoiceNumber(n: number): string {
  return `INV-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`;
}

async function nextInvoiceNumber(): Promise<string> {
  const count = await prisma.invoice.count();
  return padInvoiceNumber(count + 1);
}

export async function generateSubscriptionInvoice(companyId: string): Promise<string> {
  const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
  if (!sub) throw new Error('Subscription not found');

  const seatCount = await countBillableSeats(companyId);
  const { extraSeats, monthlyTotal, effectiveBase } = computeMonthlyTotal({
    basePriceMonthly: Number(sub.basePriceMonthly),
    negotiatedMonthlyPrice: sub.negotiatedMonthlyPrice ? Number(sub.negotiatedMonthlyPrice) : null,
    includedSeats: sub.includedSeats,
    perSeatPriceInr: Number(sub.perSeatPriceInr),
    seatCount,
  });

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + SUBSCRIPTION_PRICING.invoiceNetDays);

  const lineItems = [
    {
      description: `${SUBSCRIPTION_PRICING.planName} — base (up to ${sub.includedSeats} users)`,
      quantity: 1,
      unitPrice: effectiveBase,
      amount: effectiveBase,
    },
  ];

  if (extraSeats > 0) {
    lineItems.push({
      description: `Additional users (${extraSeats} × ₹${Number(sub.perSeatPriceInr)})`,
      quantity: extraSeats,
      unitPrice: Number(sub.perSeatPriceInr),
      amount: extraSeats * Number(sub.perSeatPriceInr),
    });
  }

  const tax = 0;
  const invoice = await prisma.invoice.create({
    data: {
      companyId,
      invoiceNumber: await nextInvoiceNumber(),
      amount: monthlyTotal,
      tax,
      totalAmount: monthlyTotal + tax,
      status: 'pending',
      periodStart: now,
      periodEnd,
      dueDate,
      lineItems: lineItems as object[],
      notes: `Monthly subscription — ${seatCount} active users`,
    },
  });

  await logBillingEvent(companyId, 'invoice_generated', {
    invoiceId: invoice.id,
    amount: monthlyTotal,
  });

  return invoice.id;
}

export async function markInvoicePaid(
  invoiceId: string,
  paymentRef: string,
  paymentMethod: string,
): Promise<void> {
  const invoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'paid',
      paidAt: new Date(),
      paymentRef,
      paymentMethod,
    },
  });

  await logBillingEvent(invoice.companyId, 'invoice_paid', { invoiceId, paymentRef });
}

export async function markOverdueInvoices(): Promise<number> {
  const now = new Date();
  const result = await prisma.invoice.updateMany({
    where: {
      status: 'pending',
      dueDate: { lt: now },
    },
    data: { status: 'overdue' },
  });
  return result.count;
}
