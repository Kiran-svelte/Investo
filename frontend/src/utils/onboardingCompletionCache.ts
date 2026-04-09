const ONBOARDING_COMPLETION_KEY_PREFIX = 'investo:onboardingCompleted:';

export function getOnboardingCompletionCacheKey(companyId: string) {
  return `${ONBOARDING_COMPLETION_KEY_PREFIX}${companyId}`;
}

export function getOnboardingCompletionFromCache(companyId: string): boolean | null {
  try {
    const raw = localStorage.getItem(getOnboardingCompletionCacheKey(companyId));
    if (raw === null) {
      return null;
    }
    return raw === '1';
  } catch {
    return null;
  }
}

export function setOnboardingCompletionCache(companyId: string, completed: boolean): void {
  try {
    const key = getOnboardingCompletionCacheKey(companyId);
    if (completed) {
      localStorage.setItem(key, '1');
      return;
    }
    localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}
