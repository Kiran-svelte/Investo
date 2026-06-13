import api from '../services/api';
import type { UserRole } from '../context/AuthContext';
import { getRoleHomePath } from '../config/navigation.config';
import { getOnboardingCompletionFromCache } from './onboardingCompletionCache';

export type PostAuthUser = {
  role?: UserRole;
  company_id?: string | null;
  must_change_password?: boolean;
};

export async function companyAdminNeedsOnboarding(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return true;

  const cached = getOnboardingCompletionFromCache(companyId);
  if (cached === true) return false;
  if (cached === false) return true;

  try {
    const { data } = await api.get('/onboarding/status', { timeout: 12_000 });
    const completedSteps = Array.isArray(data?.data?.completedSteps) ? data.data.completedSteps : [];
    const isComplete = completedSteps.includes(6);
    return !isComplete;
  } catch {
    return true;
  }
}

/**
 * Where to send the user immediately after login or mandatory password change.
 * Company admins with incomplete onboarding always go to /onboarding first.
 */
export async function resolvePostAuthPath(user: PostAuthUser | null | undefined): Promise<string> {
  if (!user?.role) return '/login';
  if (user.must_change_password) return '/change-password';

  if (user.role === 'company_admin') {
    const needsOnboarding = await companyAdminNeedsOnboarding(user.company_id);
    if (needsOnboarding) return '/onboarding';
  }

  return getRoleHomePath(user.role);
}
