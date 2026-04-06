import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    let active = true;

    const loadFeatures = async () => {
      if (!isAuthenticated || !user) {
        if (active) {
          setFeatures({});
          setLoading(false);
        }
        return;
      }

      if (user.role === 'super_admin') {
        if (active) {
          setFeatures({});
          setLoading(false);
        }
        return;
      }

      try {
        const response = await api.get('/features');
        const items: FeatureItem[] = response.data?.data || [];
        const map: Record<string, boolean> = {};
        items.forEach((item) => {
          map[item.key] = item.enabled !== false;
        });

        if (active) {
          setFeatures(map);
        }
      } catch {
        if (active) {
          setFeatures({});
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    void loadFeatures();

    return () => {
      active = false;
    };
  }, [isAuthenticated, user]);

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
      return true;
    };
  }, [features, user?.role]);

  return {
    features,
    isFeatureEnabled,
    loading,
  };
};

export default useCompanyFeatures;
