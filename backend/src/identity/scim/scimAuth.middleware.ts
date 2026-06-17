import { Response, NextFunction } from 'express';
import { Request } from 'express';

import { findCompanyIdByScimToken } from '../identityConfig.service';

export interface ScimRequest extends Request {
  scimCompanyId?: string;
}

export async function scimAuthMiddleware(req: ScimRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail: 'Missing SCIM bearer token',
      status: '401',
    });
    return;
  }

  const companyId = await findCompanyIdByScimToken(token);
  if (!companyId) {
    res.status(401).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail: 'Invalid SCIM bearer token',
      status: '401',
    });
    return;
  }

  req.scimCompanyId = companyId;
  next();
}
