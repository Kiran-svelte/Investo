import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { syncClarityPage } from '../../services/clarity';

const ClarityAnalytics: React.FC = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();

  useEffect(() => {
    syncClarityPage(pathname, user);
  }, [pathname, user]);

  return null;
};

export default ClarityAnalytics;
