/**
 * Invoice routes.
 *
 * BILLING DISABLED: All endpoints return 410 Gone.
 * The full implementation is preserved below as comments for future re-enablement.
 * When billing is re-enabled, remove the 410 stubs and restore the original handlers.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';

/** Standard 410 response for any billing endpoint. */
function billingDisabled(_req: Request, res: Response): void {
  res.status(410).json({
    error: {
      code: 'billing_disabled',
      message: 'Invoice management is not available in this version.',
    },
  });
}

const router = Router();

router.use(authenticate);

/** GET /api/subscriptions/invoices */
router.get('/', billingDisabled);

/** GET /api/subscriptions/invoices/:id */
router.get('/:id', billingDisabled);

/** POST /api/subscriptions/invoices */
router.post('/', billingDisabled);

/** PUT /api/subscriptions/invoices/:id/pay */
router.put('/:id/pay', billingDisabled);

/** GET /api/subscriptions/invoices/:id/download */
router.get('/:id/download', billingDisabled);

/** POST /api/subscriptions/invoices/generate-monthly — super_admin only */
router.post('/generate-monthly', billingDisabled);

export default router;
