import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

interface FeatureItem {
  key: string;
  enabled: boolean;
}

export const useCompanyFeatures = () => {
  const { user, isAuthenticated } = useAuth();
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFeatures = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setFeatures({});
      setError(null);
      setLoading(false);
      return;
    }

    if (user.role === 'super_admin') {
      setFeatures({});
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await api.get('/features');
      const items: FeatureItem[] = response.data?.data || [];
      const map: Record<string, boolean> = {};
      items.forEach((item) => {
        map[item.key] = item.enabled !== false;
      });
      setFeatures(map);
      setError(null);
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
      if (!featureKey) {
        return true;
      }
      if (user?.role === 'super_admin') {
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(features, featureKey)) {
        return features[featureKey];
      }
      // Match backend: features default to enabled when not stored yet
      return true;
    };
  }, [features, user?.role]);

  return {
    features,
    isFeatureEnabled,
    loading,
    error,
    reload: loadFeatures,
  };
};

export default useCompanyFeatures;
