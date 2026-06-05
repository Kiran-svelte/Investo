/**
 * Subscription enforcement middleware.
 *
 * BILLING DISABLED: Both middlewares are no-ops that call next() immediately.
 * No plan checks, no invoice checks, no quota limits apply.
 *
 * To re-enable billing enforcement:
 * 1. Restore the original DB-backed implementations (see git history).
 * 2. Ensure all companies have a planId assigned before enabling.
 * 3. Run a migration to backfill any missing plan associations.
 *
 * @module subscriptionEnforcement
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import logger from '../config/logger';

/**
 * No-op middleware: billing is disabled.
 * Previously checked for active paid subscription + non-overdue invoices.
 *
 * @param _req - Express request (unused)
 * @param _res - Express response (unused)
 * @param next - Next middleware
 */
export async function requireActivePaidSubscription(
  _req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  // BILLING DISABLED — all companies pass through unconditionally.
  // Remove this bypass and restore DB logic when billing goes live.
  next();
}

/**
 * No-op middleware factory: billing is disabled.
 * Previously enforced per-plan limits on agents, leads, and properties.
 *
 * @param _resource - 'agents' | 'leads' | 'properties' (unused while billing is disabled)
 * @returns Express middleware that always calls next()
 */
export function enforcePlanLimit(_resource: 'agents' | 'leads' | 'properties') {
  return async (
    _req: AuthRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // BILLING DISABLED — plan limits are not enforced.
    // Remove this bypass and restore DB logic when billing goes live.
    next();
  };
}

// Log once at startup so ops teams know billing is bypassed intentionally.
logger.info('Subscription enforcement: BILLING DISABLED — all limits bypassed', {
  module: 'subscriptionEnforcement',
});
