import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
/**
 * Audit logging middleware factory.
 * Creates an audit log entry for write operations.
 */
export declare function auditLog(action: string, resourceType: string): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=audit.d.ts.map