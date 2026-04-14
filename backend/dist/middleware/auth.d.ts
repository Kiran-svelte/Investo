import { Request, Response, NextFunction } from 'express';
export interface AuthUser {
    id: string;
    company_id: string;
    companyId?: string;
    email: string;
    role: string;
    name: string;
    customRoleId?: string | null;
}
export interface AuthRequest extends Request {
    user?: AuthUser;
}
export declare function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map