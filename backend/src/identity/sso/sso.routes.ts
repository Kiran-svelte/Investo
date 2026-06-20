import { Router, Request, Response } from 'express';

import config from '../../config';
import { ssoService } from '../sso/sso.service';
import { getPublicSsoConfig } from '../keycloak/platformKeycloak.service';
import { normalizeAuthEmail } from '../../services/auth.service';
import { setAuthSessionCookies, authSessionResponseMeta } from '../../utils/authSessionCookies.util';
import prisma from '../../config/prisma';

const router = Router();

router.get('/config', (_req: Request, res: Response) => {
  res.json({ data: getPublicSsoConfig() });
});

function redirectSsoError(res: Response, message: string): void {
  const url = new URL(`${config.frontend.baseUrl}/auth/sso`);
  url.searchParams.set('error', message.slice(0, 240));
  res.redirect(url.toString());
}

router.get('/start', async (req: Request, res: Response) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    if (!email) {
      res.status(400).json({ error: 'email query parameter required' });
      return;
    }
    const result = await ssoService.startLogin(email);
    res.json({ data: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'SSO start failed' });
  }
});

async function finishSsoLogin(
  res: Response,
  wantsJson: boolean,
  tokens: Awaited<ReturnType<typeof ssoService.completeCallback>>,
  email: string,
): Promise<void> {
  setAuthSessionCookies(res, tokens);
  const user = await prisma.user.findFirst({
    where: { email: normalizeAuthEmail(email), status: 'active' },
    select: { id: true, companyId: true, email: true, role: true, name: true, mustChangePassword: true },
  });
  if (!wantsJson) {
    res.redirect(`${config.frontend.baseUrl}/auth/sso/complete`);
    return;
  }
  res.json({
    success: true,
    message: 'SSO login successful',
    data: {
      user: user ? {
        id: user.id,
        company_id: user.companyId,
        email: user.email,
        role: user.role,
        name: user.name,
        must_change_password: user.mustChangePassword,
      } : null,
      tokens: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      },
      session: authSessionResponseMeta(),
    },
  });
}

router.get('/callback', async (req: Request, res: Response) => {
  const wantsJson = req.headers.accept?.includes('application/json')
    || req.query.format === 'json';

  try {
    if (req.query.test === '1') {
      const email = typeof req.query.email === 'string' ? req.query.email : '';
      if (!email) {
        if (wantsJson) {
          res.status(400).json({ error: 'email required' });
          return;
        }
        redirectSsoError(res, 'SSO callback missing email');
        return;
      }

      const name = typeof req.query.name === 'string' ? req.query.name : email.split('@')[0];
      const externalId = typeof req.query.external_id === 'string' ? req.query.external_id : `test:${email}`;
      const tokens = await ssoService.completeCallback({ email, name, external_id: externalId });
      await finishSsoLogin(res, wantsJson, tokens, email);
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (code && state) {
      const result = await ssoService.completeOidcCallback(code, state);
      await finishSsoLogin(res, wantsJson, result.tokens, result.email);
      return;
    }

    if (wantsJson) {
      res.status(400).json({ error: 'Missing SSO callback parameters' });
      return;
    }
    redirectSsoError(res, 'Invalid SSO callback. Use password login or contact your admin.');
  } catch (err: any) {
    const message = err.message || 'SSO callback failed';
    if (wantsJson) {
      res.status(400).json({ error: message });
      return;
    }
    redirectSsoError(res, message);
  }
});

export default router;
