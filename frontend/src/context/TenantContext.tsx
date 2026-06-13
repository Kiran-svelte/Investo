import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

import { getStoredTargetCompanyId, getStoredTargetCompanyName, setStoredTargetCompany } from '../utils/tenantContextStorage';

type TenantContextValue = {
  targetCompanyId: string | null;
  targetCompanyName: string | null;
  setTargetCompany: (companyId: string | null, companyName?: string | null) => void;
  clearTargetCompany: () => void;
  isPlatformAdmin: boolean;
};

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === 'super_admin';

  const [targetCompanyId, setTargetCompanyId] = useState<string | null>(() => getStoredTargetCompanyId());
  const [targetCompanyName, setTargetCompanyName] = useState<string | null>(() => getStoredTargetCompanyName());

  const setTargetCompany = useCallback((companyId: string | null, companyName?: string | null) => {
    setTargetCompanyId(companyId);
    setTargetCompanyName(companyName ?? null);
    setStoredTargetCompany(companyId, companyName ?? null);
  }, []);

  const clearTargetCompany = useCallback(() => {
    setTargetCompany(null, null);
  }, [setTargetCompany]);

  const value = useMemo<TenantContextValue>(() => ({
    targetCompanyId: isPlatformAdmin ? targetCompanyId : null,
    targetCompanyName: isPlatformAdmin ? targetCompanyName : null,
    setTargetCompany,
    clearTargetCompany,
    isPlatformAdmin,
  }), [clearTargetCompany, isPlatformAdmin, setTargetCompany, targetCompanyId, targetCompanyName]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export function useTenantContext(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenantContext must be used within TenantProvider');
  }
  return ctx;
}
