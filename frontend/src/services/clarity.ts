import Clarity from '@microsoft/clarity';
import type { AuthUser } from '../context/AuthContext';

const DEFAULT_PROJECT_ID = 'x9uanyc7kt';

let initialized = false;

function getProjectId(): string | null {
  const fromEnv = import.meta.env.VITE_CLARITY_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;
  if (import.meta.env.PROD) return DEFAULT_PROJECT_ID;
  return null;
}

export function initClarity(): void {
  if (initialized || typeof window === 'undefined') return;

  const projectId = getProjectId();
  if (!projectId) return;

  Clarity.init(projectId);
  initialized = true;
}

export function identifyClarityUser(user: AuthUser, pagePath?: string): void {
  if (!initialized) return;

  Clarity.identify(user.id, undefined, pagePath, user.name);

  Clarity.setTag('role', user.role);
  if (user.company_id) {
    Clarity.setTag('company_id', user.company_id);
  }
}

export function syncClarityPage(pagePath: string, user: AuthUser | null): void {
  if (!initialized) return;

  if (user) {
    identifyClarityUser(user, pagePath);
    return;
  }

  Clarity.setTag('page', pagePath);
}

export function trackClarityEvent(eventName: string, metadata?: Record<string, string>): void {
  if (!initialized || typeof window === 'undefined') return;

  Clarity.event(eventName);
  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      if (value) {
        Clarity.setTag(key, value);
      }
    }
  }
}
