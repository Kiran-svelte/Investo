import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { cacheGet, cacheSet } from '../config/redis';
import { readAccessTokenFromCookies } from '../utils/authSessionCookies.util';
import { ipAllowlistMiddleware } from './ipAllowlist';

const AUTH_CACHE_TTL_SECONDS = 300; // 5 minutes

const neonJwksUri = config.neonAuth.url ? `${config.neonAuth.url}/.well-known/jwks.json` : '';
const neonJwksClient = neonJwksUri
  ? jwksClient({
      jwksUri: neonJwksUri,
      cache: true,
      rateLimit: true,
    })
  : null;

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  if (!neonJwksClient) {
    callback(new Error('Neon Auth URL not configured'));
    return;
  }

  if (!header.kid) {
    callback(new Error('Missing key id in JWT header'));
    return;
  }

  neonJwksClient.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err || new Error('No key found'));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

function verifyLegacyToken(token: string): jwt.JwtPayload | null {
  try {
    return jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
  } catch {
    return null;
  }
}

async function verifyNeonToken(token: string): Promise<jwt.JwtPayload | null> {
  if (!neonJwksClient) {
    return null;
  }

  return await new Promise((resolve) => {
    jwt.verify(token, getKey, (err: any, decodedPayload: any) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve((decodedPayload || null) as jwt.JwtPayload | null);
    });
  });
}

export interface AuthUser {
  id: string;
  company_id: string;
  companyId?: string; // alias for RBAC
  email: string;
  role: string;
  name: string;
  customRoleId?: string | null;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const cookieToken = readAccessTokenFromCookies(req.headers.cookie);
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const token = bearerToken || cookieToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  // Use a short hash of the token as the cache key (tokens are large and sensitive)
  const tokenCacheKey = `auth:user:${Buffer.from(token).toString('base64').slice(-40)}`;

  try {
    let user: any = null;

    // Fast path: check Redis cache first (eliminates DB round-trip on most requests)
    const cached = await cacheGet<AuthUser>(tokenCacheKey);
    if (cached) {
      req.user = cached;
      next();
      return;
    }

    // 1) Legacy token path (existing app JWT)
    const legacyPayload = verifyLegacyToken(token);
    if (legacyPayload?.userId) {
      user = await prisma.user.findFirst({
        where: { id: String(legacyPayload.userId), status: 'active' },
      });
    }

    // 2) Neon token path (new auth)
    if (!user) {
      const neonPayload = await verifyNeonToken(token);

      if (neonPayload) {
        const userEmail = typeof neonPayload.email === 'string' ? neonPayload.email.toLowerCase() : null;

        if (userEmail) {
          user = await prisma.user.findFirst({
            where: {
              email: userEmail,
              status: 'active',
            },
          });
        }
      }
    }

    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    if (user.role !== 'super_admin') {
      const company = await prisma.company.findFirst({
        where: { id: user.companyId, status: 'active' },
      });

      if (!company) {
        res.status(403).json({ error: 'Company is inactive or suspended' });
        return;
      }
    }

    const authUser: AuthUser = {
      id: user.id,
      company_id: user.companyId,
      companyId: user.companyId,
      email: user.email,
      role: user.role,
      name: user.name,
      customRoleId: user.customRoleId || null,
    };

    // Cache the resolved user record for AUTH_CACHE_TTL_SECONDS
    await cacheSet(tokenCacheKey, authUser, AUTH_CACHE_TTL_SECONDS).catch(() => undefined);

    req.user = authUser;

    await new Promise<void>((resolve) => {
      void ipAllowlistMiddleware(req, res, () => resolve());
    });
    if (res.headersSent) {
      return;
    }

    next();
  } catch (err: any) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }
    logger.warn('Invalid token attempt', { error: err.message });
    res.status(401).json({ error: 'Invalid token' });
  }
}
