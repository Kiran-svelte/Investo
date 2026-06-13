export const PLATFORM_COMPANY_SLUG = 'investo-platform';

export function isPlatformCompany(company: { slug?: string | null } | null | undefined): boolean {
  return (company?.slug || '').trim() === PLATFORM_COMPANY_SLUG;
}
