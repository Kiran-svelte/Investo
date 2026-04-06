import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import prisma from '../config/prisma';

/**
 * Audit logging middleware factory.
 * Creates an audit log entry for write operations.
 */
export function auditLog(action: string, resourceType: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    // Store original json method to capture response
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      // Only log successful write operations
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const user = req.user;
        if (user) {
          prisma.auditLog
            .create({
              data: {
                companyId: user.role === 'super_admin' ? (req as any).companyId || null : user.company_id,
                userId: user.id,
                action,
                resourceType,
                resourceId: body?.id || req.params?.id || null,
                details: {
                  method: req.method,
                  path: req.path,
                  params: req.params,
                },
                ipAddress: req.ip || req.socket.remoteAddress || null,
              },
            })
            .catch((err: Error) => {
              // Audit log failure must not break the request
              console.error('Audit log write failed:', err.message);
            });
        }
      }
      return originalJson(body);
    } as any;

    next();
  };
}
