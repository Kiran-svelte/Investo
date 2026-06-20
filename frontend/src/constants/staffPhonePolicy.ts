export const STAFF_ROLES_REQUIRING_PHONE = new Set([
  'company_admin',
  'sales_agent',
  'operations',
]);

export const STAFF_PHONE_REQUIRED_MESSAGE = 'Phone number is required for staff who use WhatsApp copilot.';

export function requiresStaffPhone(role: string | null | undefined): boolean {
  if (!role) return false;
  return STAFF_ROLES_REQUIRING_PHONE.has(String(role).trim().toLowerCase());
}
