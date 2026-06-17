import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import config from '../config';
import logger from '../config/logger';
import {
  acceptAgencyInvite,
  createAgencyInvite,
  getInviteByToken,
  listAgencyInvites,
} from '../services/billing/agencyInvite.service';

const router = Router();

const createInviteSchema = z.object({
  agency_name: z.string().min(2).max(255),
  admin_email: z.string().email(),
  negotiated_monthly_price: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});

const acceptInviteSchema = z.object({
  admin_name: z.string().min(2).max(255),
  password: z.string().min(8).max(128),
  whatsapp_phone: z.string().optional(),
});

/** GET /api/agency-invites/:token — public */
router.get('/:token', async (req, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: 'Billing is disabled' });
    return;
  }
  try {
    const invite = await getInviteByToken(req.params.token);
    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }
    res.json({
      data: {
        agencyName: invite.agencyName,
        adminEmail: invite.adminEmail,
        expiresAt: invite.expiresAt.toISOString(),
        status: invite.status,
        negotiatedMonthlyPrice: invite.negotiatedMonthlyPrice
          ? Number(invite.negotiatedMonthlyPrice)
          : null,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to load invite' });
  }
});

/** POST /api/agency-invites/:token/accept — public */
router.post('/:token/accept', validate(acceptInviteSchema), async (req, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: 'Billing is disabled' });
    return;
  }
  try {
    const result = await acceptAgencyInvite({
      token: req.params.token,
      adminName: req.body.admin_name,
      password: req.body.password,
      whatsappPhone: req.body.whatsapp_phone,
    });
    res.status(201).json({ data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to accept invite';
    res.status(400).json({ error: message });
  }
});

/** POST /api/agency-invites — super_admin */
router.post('/', authenticate, hasRole('super_admin'), validate(createInviteSchema), async (req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: 'Billing is disabled' });
    return;
  }
  try {
    const result = await createAgencyInvite({
      agencyName: req.body.agency_name,
      adminEmail: req.body.admin_email,
      negotiatedMonthlyPrice: req.body.negotiated_monthly_price,
      notes: req.body.notes,
      createdById: req.user!.id,
    });
    res.status(201).json({ data: result });
  } catch (err: unknown) {
    logger.error('Failed to create agency invite', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

/** GET /api/agency-invites — super_admin list */
router.get('/', authenticate, hasRole('super_admin'), async (_req: AuthRequest, res: Response) => {
  if (!config.features.billing) {
    res.status(410).json({ error: 'Billing is disabled' });
    return;
  }
  try {
    const invites = await listAgencyInvites();
    res.json({
      data: invites.map((inv) => ({
        id: inv.id,
        agencyName: inv.agencyName,
        adminEmail: inv.adminEmail,
        expiresAt: inv.expiresAt.toISOString(),
        acceptedAt: inv.acceptedAt?.toISOString() ?? null,
        companyId: inv.companyId,
        negotiatedMonthlyPrice: inv.negotiatedMonthlyPrice ? Number(inv.negotiatedMonthlyPrice) : null,
        inviteUrl: `${config.frontend.baseUrl}/accept-invite/${inv.token}`,
      })),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to list invites' });
  }
});

export default router;
