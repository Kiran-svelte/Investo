import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { Role } from '../models/validation';
type Permission = 'create' | 'read' | 'update' | 'delete';
type Resource = 'platform_settings' | 'companies' | 'subscriptions' | 'users' | 'leads' | 'properties' | 'conversations' | 'visits' | 'analytics' | 'ai_settings' | 'audit_logs' | 'notifications';
export declare function authorize(resource: Resource, permission: Permission): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
export declare function hasRole(...roles: Role[]): (req: AuthRequest, res: Response, next: NextFunction) => void;
export {};
//# sourceMappingURL=rbac.d.ts.map