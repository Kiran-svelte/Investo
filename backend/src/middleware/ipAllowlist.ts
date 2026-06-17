import type { Response, NextFunction } from 'express';

import prisma from '../config/prisma';
import config from '../config';
import type { AuthRequest } from './auth';

function prismaClient(): any {
  return prisma as any;
}

function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('::ffff:')) {
    return value.slice(7);
  }
  return value;
}

function ipAllowed(clientIp: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => {
    const normalized = entry.trim();
    if (!normalized) return false;
    if (normalized.includes('/')) {
      const [network, bitsRaw] = normalized.split('/');
      const bits = Number.parseInt(bitsRaw, 10);
      if (!network || Number.isNaN(bits)) return false;
      const ipParts = clientIp.split('.').map((part) => Number.parseInt(part, 10));
      const netParts = network.split('.').map((part) => Number.parseInt(part, 10));
      if (ipParts.length !== 4 || netParts.length !== 4) return false;
      const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
      const netNum = (netParts[0] << 24) + (netParts[1] << 16) + (netParts[2] << 8) + netParts[3];
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (ipNum & mask) === (netNum & mask);
    }
    return clientIp === normalized;
  });
}

export async function ipAllowlistMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (config.features.ipAllowlist !== true || !req.user?.company_id) {
    next();
    return;
  }

  const row = await prismaClient().companyIdentityConfig.findUnique({
    where: { companyId: req.user.company_id },
  });

  if (!row?.ipAllowlistEnabled) {
    next();
    return;
  }

  const allowlist = Array.isArray(row.ipAllowlist) ? row.ipAllowlist.map(String) : [];
  if (allowlist.length === 0) {
    next();
    return;
  }

  const clientIp = normalizeIp(req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0]);
  if (!clientIp || !ipAllowed(clientIp, allowlist)) {
    res.status(403).json({ error: 'Access denied from this network location' });
    return;
  }

  next();
}
