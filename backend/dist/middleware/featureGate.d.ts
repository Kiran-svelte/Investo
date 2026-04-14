import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
export type FeatureKey = 'ai_bot' | 'analytics' | 'visit_scheduling' | 'notifications' | 'agent_management' | 'conversation_center' | 'lead_automation' | 'property_management' | 'audit_logs' | 'csv_export';
export declare function requireFeature(featureKey: FeatureKey): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=featureGate.d.ts.map