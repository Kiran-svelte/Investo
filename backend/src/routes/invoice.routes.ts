import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { auditLog } from '../middleware/audit';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);

/**
 * Generate unique invoice number
 * Format: INV-YYYYMM-XXXX
 */
async function generateInvoiceNumber(companyId: string): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Count invoices for this month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  
  const count = await prisma.invoice.count({
    where: {
      companyId,
      createdAt: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    },
  });
  
  return `INV-${yearMonth}-${String(count + 1).padStart(4, '0')}`;
}

/**
 * GET /api/subscriptions/invoices
 * List invoices for current company
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { user } = req;
    const { status, page = '1', limit = '20' } = req.query;
    
    const where: any = {};
    
    // Super admin can see all invoices, others see their company's
    if (user!.role !== 'super_admin') {
      where.companyId = user!.companyId;
    } else if (req.query.company_id) {
      where.companyId = req.query.company_id;
    }
    
    if (status) {
      where.status = status;
    }
    
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);
    
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          company: {
            select: { name: true, slug: true },
          },
        },
      }),
      prisma.invoice.count({ where }),
    ]);
    
    res.json({
      data: invoices,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (err: any) {
    logger.error('Failed to fetch invoices', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

/**
 * GET /api/subscriptions/invoices/:id
 * Get a specific invoice
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { user } = req;
    const { id } = req.params;
    
    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        ...(user!.role !== 'super_admin' ? { companyId: user!.companyId } : {}),
      },
      include: {
        company: {
          select: {
            name: true,
            slug: true,
            settings: true,
            plan: {
              select: { name: true },
            },
          },
        },
      },
    });
    
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    
    res.json({ data: invoice });
  } catch (err: any) {
    logger.error('Failed to fetch invoice', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

/**
 * POST /api/subscriptions/invoices
 * Create a new invoice (super_admin or company_admin)
 */
router.post(
  '/',
  hasRole('super_admin', 'company_admin'),
  auditLog('create', 'invoices'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { user } = req;
      const {
        company_id,
        amount,
        tax = 0,
        period_start,
        period_end,
        due_date,
        notes,
      } = req.body;
      
      // Determine company ID
      const companyId = user!.role === 'super_admin' && company_id 
        ? company_id 
        : user!.companyId;
      
      // Validate company exists
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        include: { plan: true },
      });
      
      if (!company) {
        res.status(404).json({ error: 'Company not found' });
        return;
      }
      
      const invoiceNumber = await generateInvoiceNumber(companyId);
      const amountDecimal = parseFloat(amount);
      const taxDecimal = parseFloat(tax) || 0;
      const totalAmount = amountDecimal + taxDecimal;
      
      const invoice = await prisma.invoice.create({
        data: {
          companyId,
          invoiceNumber,
          amount: amountDecimal,
          tax: taxDecimal,
          totalAmount,
          periodStart: new Date(period_start),
          periodEnd: new Date(period_end),
          dueDate: new Date(due_date),
          notes,
        },
        include: {
          company: {
            select: { name: true, slug: true },
          },
        },
      });
      
      logger.info('Invoice created', { 
        invoiceId: invoice.id, 
        invoiceNumber: invoice.invoiceNumber,
        companyId,
        amount: totalAmount,
      });
      
      res.status(201).json({ data: invoice, id: invoice.id });
    } catch (err: any) {
      logger.error('Failed to create invoice', { error: err.message });
      res.status(500).json({ error: 'Failed to create invoice' });
    }
  }
);

/**
 * PUT /api/subscriptions/invoices/:id/pay
 * Mark invoice as paid
 */
router.put(
  '/:id/pay',
  hasRole('super_admin', 'company_admin'),
  auditLog('update', 'invoices'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { user } = req;
      const { id } = req.params;
      const { payment_method, payment_ref } = req.body;
      
      const invoice = await prisma.invoice.findFirst({
        where: {
          id,
          ...(user!.role !== 'super_admin' ? { companyId: user!.companyId } : {}),
        },
      });
      
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      
      if (invoice.status === 'paid') {
        res.status(400).json({ error: 'Invoice already paid' });
        return;
      }
      
      const updated = await prisma.invoice.update({
        where: { id },
        data: {
          status: 'paid',
          paidAt: new Date(),
          paymentMethod: payment_method,
          paymentRef: payment_ref,
        },
        include: {
          company: {
            select: { name: true, slug: true },
          },
        },
      });
      
      logger.info('Invoice marked as paid', { 
        invoiceId: id, 
        paymentMethod: payment_method,
        paymentRef: payment_ref,
      });
      
      res.json({ data: updated });
    } catch (err: any) {
      logger.error('Failed to mark invoice as paid', { error: err.message });
      res.status(500).json({ error: 'Failed to update invoice' });
    }
  }
);

/**
 * GET /api/subscriptions/invoices/:id/download
 * Download invoice as PDF
 */
router.get('/:id/download', async (req: AuthRequest, res: Response) => {
  try {
    const { user } = req;
    const { id } = req.params;
    
    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        ...(user!.role !== 'super_admin' ? { companyId: user!.companyId } : {}),
      },
      include: {
        company: {
          select: {
            name: true,
            slug: true,
            settings: true,
            whatsappPhone: true,
            plan: {
              select: { name: true, priceMonthly: true },
            },
          },
        },
      },
    });
    
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    
    // Generate PDF content (using simple HTML-to-text for now)
    // In production, use pdfkit or puppeteer
    const settings = invoice.company.settings as any || {};
    
    const pdfContent = generateInvoicePDF(invoice, settings);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdfContent);
  } catch (err: any) {
    logger.error('Failed to download invoice', { error: err.message });
    res.status(500).json({ error: 'Failed to download invoice' });
  }
});

/**
 * Generate Invoice PDF
 * Simple PDF generation - replace with pdfkit for production
 */
function generateInvoicePDF(invoice: any, companySettings: any): Buffer {
  // Generate a simple text-based PDF representation
  // This is a placeholder - in production use pdfkit or similar
  
  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  
  const formatDate = (date: Date) => 
    new Date(date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  
  const content = `
%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 1000 >>
stream
BT
/F1 24 Tf
50 742 Td
(INVOICE) Tj
0 -30 Td
/F1 12 Tf
(Invoice Number: ${invoice.invoiceNumber}) Tj
0 -20 Td
(Date: ${formatDate(invoice.createdAt)}) Tj
0 -20 Td
(Due Date: ${formatDate(invoice.dueDate)}) Tj
0 -40 Td
/F1 14 Tf
(Bill To:) Tj
0 -20 Td
/F1 12 Tf
(${invoice.company.name}) Tj
0 -40 Td
/F1 14 Tf
(Subscription Details:) Tj
0 -20 Td
/F1 12 Tf
(Plan: ${invoice.company.plan?.name || 'N/A'}) Tj
0 -20 Td
(Period: ${formatDate(invoice.periodStart)} to ${formatDate(invoice.periodEnd)}) Tj
0 -40 Td
(Subtotal: ${formatCurrency(Number(invoice.amount))}) Tj
0 -20 Td
(Tax: ${formatCurrency(Number(invoice.tax))}) Tj
0 -20 Td
/F1 14 Tf
(Total: ${formatCurrency(Number(invoice.totalAmount))}) Tj
0 -40 Td
/F1 12 Tf
(Status: ${invoice.status.toUpperCase()}) Tj
${invoice.paidAt ? `0 -20 Td
(Paid on: ${formatDate(invoice.paidAt)}) Tj` : ''}
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000268 00000 n 
0000001318 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
1398
%%EOF
`;
  
  return Buffer.from(content, 'utf-8');
}

/**
 * POST /api/subscriptions/invoices/generate-monthly
 * Generate monthly invoices for all active companies (cron job endpoint)
 * Super admin only
 */
router.post(
  '/generate-monthly',
  hasRole('super_admin'),
  auditLog('create', 'invoices'),
  async (req: AuthRequest, res: Response) => {
    try {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 15); // Due 15th of next month
      
      // Get all active companies with plans
      const companies = await prisma.company.findMany({
        where: {
          status: 'active',
          planId: { not: null },
        },
        include: {
          plan: true,
        },
      });
      
      const createdInvoices = [];
      const errors = [];
      
      for (const company of companies) {
        if (!company.plan || Number(company.plan.priceMonthly) === 0) {
          continue; // Skip free plans
        }
        
        // Check if invoice already exists for this period
        const existing = await prisma.invoice.findFirst({
          where: {
            companyId: company.id,
            periodStart,
            periodEnd,
          },
        });
        
        if (existing) {
          continue; // Skip if invoice already exists
        }
        
        try {
          const invoiceNumber = await generateInvoiceNumber(company.id);
          const amount = Number(company.plan.priceMonthly);
          const tax = amount * 0.18; // 18% GST
          
          const invoice = await prisma.invoice.create({
            data: {
              companyId: company.id,
              invoiceNumber,
              amount,
              tax,
              totalAmount: amount + tax,
              periodStart,
              periodEnd,
              dueDate,
            },
          });
          
          createdInvoices.push(invoice);
        } catch (err: any) {
          errors.push({ companyId: company.id, error: err.message });
        }
      }
      
      logger.info('Monthly invoices generated', {
        created: createdInvoices.length,
        errors: errors.length,
      });
      
      res.json({
        message: `Generated ${createdInvoices.length} invoices`,
        invoices: createdInvoices,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err: any) {
      logger.error('Failed to generate monthly invoices', { error: err.message });
      res.status(500).json({ error: 'Failed to generate invoices' });
    }
  }
);

export default router;
