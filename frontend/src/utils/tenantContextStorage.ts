const STORAGE_KEY = 'investo_target_company_id';
const STORAGE_NAME_KEY = 'investo_target_company_name';

let tenantContextRequestScopeEnabled = false;

export function getStoredTargetCompanyId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function getStoredTargetCompanyName(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_NAME_KEY);
}

export function setStoredTargetCompany(companyId: string | null, companyName?: string | null): void {
  if (typeof window === 'undefined') return;
  if (companyId) {
    sessionStorage.setItem(STORAGE_KEY, companyId);
    if (companyName) sessionStorage.setItem(STORAGE_NAME_KEY, companyName);
    else sessionStorage.removeItem(STORAGE_NAME_KEY);
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_NAME_KEY);
  }
}

export function setTenantContextRequestScopeEnabled(enabled: boolean): void {
  tenantContextRequestScopeEnabled = enabled;
}

export function getRequestTargetCompanyId(): string | null {
  if (!tenantContextRequestScopeEnabled) return null;
  return getStoredTargetCompanyId();
}
