/**
 * Cross-tab mutex so only one refresh runs at a time.
 * Prevents refresh-token rotation races when multiple tabs get 401 together.
 */
const LOCK_KEY = 'investo_auth_refresh_lock';
const LOCK_TTL_MS = 15_000;

function getTabId(): string {
  const key = 'investo_tab_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function readLock(): { tabId: string; until: number } | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabId?: string; until?: number };
    if (!parsed.tabId || typeof parsed.until !== 'number') return null;
    return { tabId: parsed.tabId, until: parsed.until };
  } catch {
    return null;
  }
}

async function waitForLockRelease(maxWaitMs = 12_000): Promise<void> {
  const tabId = getTabId();
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const lock = readLock();
    if (!lock || lock.until < Date.now() || lock.tabId === tabId) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

export async function withAuthRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  await waitForLockRelease();
  const tabId = getTabId();
  localStorage.setItem(
    LOCK_KEY,
    JSON.stringify({ tabId, until: Date.now() + LOCK_TTL_MS }),
  );
  try {
    return await fn();
  } finally {
    const lock = readLock();
    if (lock?.tabId === tabId) {
      localStorage.removeItem(LOCK_KEY);
    }
  }
}
