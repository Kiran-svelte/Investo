/**
 * Subscription / billing routes.
 *
 * BILLING DISABLED: All endpoints return 410 Gone.
 * This preserves the route registry so re-enabling billing is a single
 * import swap. The route structure, RBAC guards, and audit hooks are intact.
 *
 * To re-enable: replace the 410 handler bodies with the original DB logic
 * and restore `requireActivePaidSubscription` / `enforcePlanLimit` in
 * `middleware/subscriptionEnforcement.ts`.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import invoiceRoutes from './invoice.routes';

/** Standard 410 response for any billing endpoint. */
function billingDisabled(_req: Request, res: Response): void {
  res.status(410).json({
    error: {
      code: 'billing_disabled',
      message: 'Billing and subscription management is not available in this version.',
    },
  });
}

const router = Router();

router.use(authenticate);

// Invoice sub-router: kept mounted so existing bookmarks don't hard-404,
// but invoice.routes.ts is also patched to return 410.
router.use('/invoices', invoiceRoutes);

/** GET /api/subscriptions/plans */
router.get('/plans', billingDisabled);

/** GET /api/subscriptions/plans/:id */
router.get('/plans/:id', billingDisabled);

/** POST /api/subscriptions/plans — super_admin only */
router.post('/plans', billingDisabled);

/** PUT /api/subscriptions/plans/:id — super_admin only */
router.put('/plans/:id', billingDisabled);

/** DELETE /api/subscriptions/plans/:id — super_admin only */
router.delete('/plans/:id', billingDisabled);

/** POST /api/subscriptions/select-plan */
router.post('/select-plan', billingDisabled);

export default router;
