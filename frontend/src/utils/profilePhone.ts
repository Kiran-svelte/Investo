/** Client-side check when API omits profile_complete (older backends). */
export function isProfilePhoneComplete(phone: string | null | undefined): boolean {
  if (!phone || typeof phone !== 'string') return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10;
}
