import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
type PlanLimitedResource = 'agents' | 'leads' | 'properties';
export declare function requireActivePaidSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
export declare function enforcePlanLimit(resource: PlanLimitedResource): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
export {};
//# sourceMappingURL=subscriptionEnforcement.d.ts.map