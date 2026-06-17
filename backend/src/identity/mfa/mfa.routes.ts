import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../../middleware/auth';
import { hasRole } from '../../middleware/rbac';
import { mfaService } from './mfa.service';

const router = Router();

router.post('/enroll', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await mfaService.enrollTotp(req.user!.id);
    res.json({ data: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'MFA enroll failed' });
  }
});

router.post('/verify-enrollment', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { device_id, code } = req.body || {};
    const ok = await mfaService.verifyTotpEnrollment(req.user!.id, device_id, code);
    if (!ok) {
      res.status(400).json({ error: 'Invalid MFA code' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'MFA verify failed' });
  }
});

router.post('/enroll-pending', async (req, res: Response) => {
  try {
    const { mfa_token } = req.body || {};
    const decoded = mfaService.decodeMfaToken(mfa_token);
    if (decoded.purpose !== 'mfa_enroll') {
      res.status(400).json({ error: 'MFA enrollment token required' });
      return;
    }
    const result = await mfaService.enrollTotp(decoded.userId);
    res.json({ data: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'MFA enroll failed' });
  }
});

router.post('/verify-enrollment-pending', async (req, res: Response) => {
  try {
    const { mfa_token, device_id, code } = req.body || {};
    const decoded = mfaService.decodeMfaToken(mfa_token);
    if (decoded.purpose !== 'mfa_enroll') {
      res.status(400).json({ error: 'MFA enrollment token required' });
      return;
    }
    const ok = await mfaService.verifyTotpEnrollment(decoded.userId, device_id, code);
    if (!ok) {
      res.status(400).json({ error: 'Invalid MFA code' });
      return;
    }
    const tokens = await mfaService.completeMfaChallenge(mfa_token, code);
    res.json({
      success: true,
      data: {
        tokens: {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        },
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'MFA verify failed' });
  }
});

router.post('/verify', async (req, res: Response) => {
  try {
    const { mfa_token, code } = req.body || {};
    const tokens = await mfaService.completeMfaChallenge(mfa_token, code);
    res.json({
      success: true,
      data: {
        tokens: {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        },
      },
    });
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'MFA verification failed' });
  }
});

export default router;
