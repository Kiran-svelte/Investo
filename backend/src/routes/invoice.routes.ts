import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { getCompanyId } from '../middleware/tenant';
import prisma from '../config/prisma';
import config from '../config';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);

function billingDisabled(_req: AuthRequest, res: Response): void {
  res.status(410).json({
    error: { code: 'billing_disabled', message: 'Invoice management is not available.' },
  });
}

/** GET /api/subscriptions/invoices */
router.get('/', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const companyId =
      req.user!.role === 'super_admin' && typeof req.query.company_id === 'string'
        ? req.query.company_id
        : getCompanyId(req);

    const invoices = await prisma.invoice.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      data: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: Number(inv.totalAmount),
        status: inv.status,
        dueDate: inv.dueDate.toISOString(),
        paidAt: inv.paidAt?.toISOString() ?? null,
        periodStart: inv.periodStart.toISOString(),
        periodEnd: inv.periodEnd.toISOString(),
        paymentMethod: inv.paymentMethod,
        lineItems: inv.lineItems,
      })),
    });
  } catch (err: unknown) {
    logger.error('Failed to list invoices', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

/** GET /api/subscriptions/invoices/:id */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: req.params.id,
        ...(req.user!.role !== 'super_admin' ? { companyId: getCompanyId(req) } : {}),
      },
    });
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    res.json({ data: invoice });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

/** GET /api/subscriptions/invoices/:id/download — JSON summary (PDF can be added later) */
router.get('/:id/download', async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: req.params.id,
        ...(req.user!.role !== 'super_admin' ? { companyId: getCompanyId(req) } : {}),
      },
      include: { company: { select: { name: true } } },
    });
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const payload = {
      invoiceNumber: invoice.invoiceNumber,
      companyName: invoice.company.name,
      amount: Number(invoice.amount),
      tax: Number(invoice.tax),
      totalAmount: Number(invoice.totalAmount),
      currency: invoice.currency,
      status: invoice.status,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      dueDate: invoice.dueDate,
      lineItems: invoice.lineItems,
      notes: invoice.notes,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to download invoice' });
  }
});

/** PUT /api/subscriptions/invoices/:id/pay — super_admin manual mark paid */
router.put('/:id/pay', hasRole('super_admin'), async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    billingDisabled(req, res);
    return;
  }
  try {
    const paymentRef = typeof req.body.payment_ref === 'string' ? req.body.payment_ref : `MANUAL-${Date.now()}`;
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        paymentRef,
        paymentMethod: req.body.payment_method || 'manual',
      },
    });
    res.json({ data: invoice });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to mark invoice paid' });
  }
});

export default router;
