const KEY_PREFIX = 'investo:propertyKnowledgeGate:';

export function getPropertyKnowledgeGateCacheKey(companyId: string): string {
  return `${KEY_PREFIX}${companyId}`;
}

export function getPropertyKnowledgeGateFromCache(companyId: string): boolean | null {
  try {
    const raw = localStorage.getItem(getPropertyKnowledgeGateCacheKey(companyId));
    if (raw === null) {
      return null;
    }
    return raw === '1';
  } catch {
    return null;
  }
}

/** true = blocked (must complete import knowledge), false = clear */
export function setPropertyKnowledgeGateCache(companyId: string, blocked: boolean): void {
  try {
    const key = getPropertyKnowledgeGateCacheKey(companyId);
    if (blocked) {
      localStorage.setItem(key, '1');
      return;
    }
    localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

export function clearPropertyKnowledgeGateCache(companyId: string): void {
  setPropertyKnowledgeGateCache(companyId, false);
}
