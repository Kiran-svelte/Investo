import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getRoleHomePath } from '../../config/navigation.config';
import LandingPage from '../../pages/landing/LandingPage';
import { LoadingScreen } from '../../App';

/** Public marketing home; authenticated users go to role home. */
export default function RootEntry() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to={getRoleHomePath(user?.role)} replace />;
  }

  return <LandingPage />;
}
