import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

/**
 * Only company_admin may create, upload, or publish property catalog entries.
 * Super admin manages tenants via /companies — not tenant property imports.
 */
export function requirePropertyPublisher(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const role = req.user?.role;
  if (role === 'company_admin') {
    next();
    return;
  }

  res.status(403).json({
    error: 'Only Company Admin can upload or publish properties',
    code: 'property_publisher_required',
    message:
      'Property brochures and listings must be uploaded by your company admin. Sales agents and operations can view properties; buyers interact via WhatsApp only.',
  });
}
