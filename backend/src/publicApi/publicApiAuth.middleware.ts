import { Request, Response, NextFunction } from 'express';

import { apiKeyService } from './apiKey.service';

export interface PublicApiRequest extends Request {
  publicApi?: {
    companyId: string;
    scopes: string[];
    keyId: string;
  };
}

export async function publicApiKeyAuth(req: PublicApiRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const rawKey = header.startsWith('Bearer ') ? header.slice(7).trim() : (req.headers['x-api-key'] as string | undefined);

  if (!rawKey) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  const validated = await apiKeyService.validateKey(rawKey);
  if (!validated) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  req.publicApi = validated;
  next();
}

export function requireScope(scope: string) {
  return (req: PublicApiRequest, res: Response, next: NextFunction): void => {
    const scopes = req.publicApi?.scopes || [];
    if (!scopes.includes(scope) && !scopes.includes('*')) {
      res.status(403).json({ error: 'Insufficient scope', required: scope });
      return;
    }
    next();
  };
}
