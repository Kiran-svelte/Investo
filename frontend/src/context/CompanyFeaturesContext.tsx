import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

interface FeatureItem {
  key: string;
  enabled: boolean;
}

interface CompanyFeaturesContextValue {
  features: Record<string, boolean>;
  isFeatureEnabled: (featureKey?: string) => boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const CompanyFeaturesContext = createContext<CompanyFeaturesContextValue | undefined>(undefined);

export const CompanyFeaturesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedForCompanyRef = useRef<string | null>(null);

  const loadFeatures = useCallback(async (options?: { background?: boolean }) => {
    if (!isAuthenticated || !user) {
      setFeatures({});
      setError(null);
      setLoading(false);
      loadedForCompanyRef.current = null;
      return;
    }

    if (user.role === 'super_admin') {
      setFeatures({});
      setError(null);
      setLoading(false);
      loadedForCompanyRef.current = 'super_admin';
      return;
    }

    const companyKey = user.company_id || user.id;
    const isSameCompany = loadedForCompanyRef.current === companyKey;
    if (!options?.background && !isSameCompany) {
      setLoading(true);
    }

    try {
      const response = await api.get('/features', {
        timeout: 12_000,
      });
      const items: FeatureItem[] = response.data?.data || [];
      const map: Record<string, boolean> = {};
      items.forEach((item) => {
        map[item.key] = item.enabled !== false;
      });
      setFeatures(map);
      setError(null);
      loadedForCompanyRef.current = companyKey;
    } catch {
      setFeatures({});
      setError('Failed to load company features');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    void loadFeatures();
  }, [loadFeatures]);

  const isFeatureEnabled = useMemo(() => {
    return (featureKey?: string): boolean => {
      if (!featureKey) return true;
      if (user?.role === 'super_admin') return true;
      if (Object.prototype.hasOwnProperty.call(features, featureKey)) {
        return features[featureKey];
      }
      return true;
    };
  }, [features, user?.role]);

  const value = useMemo(
    () => ({
      features,
      isFeatureEnabled,
      loading,
      error,
      reload: () => loadFeatures({ background: true }),
    }),
    [features, isFeatureEnabled, loading, error, loadFeatures],
  );

  return (
    <CompanyFeaturesContext.Provider value={value}>{children}</CompanyFeaturesContext.Provider>
  );
};

export function useCompanyFeatures(): CompanyFeaturesContextValue {
  const ctx = useContext(CompanyFeaturesContext);
  if (!ctx) {
    throw new Error('useCompanyFeatures must be used within CompanyFeaturesProvider');
  }
  return ctx;
}

export default useCompanyFeatures;
