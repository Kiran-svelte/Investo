import { describe, expect, it } from 'vitest';

/** Mirrors isFeatureEnabled logic for unit tests without React mount. */
function isFeatureEnabled(
  features: Record<string, boolean>,
  role: string | undefined,
  featureKey?: string,
): boolean {
  if (!featureKey) return true;
  if (role === 'super_admin') return true;
  if (Object.prototype.hasOwnProperty.call(features, featureKey)) {
    return features[featureKey];
  }
  return true;
}

describe('isFeatureEnabled defaults', () => {
  it('defaults unknown keys to enabled (matches backend)', () => {
    expect(isFeatureEnabled({}, 'company_admin', 'ai_bot')).toBe(true);
  });

  it('respects explicit false', () => {
    expect(isFeatureEnabled({ ai_bot: false }, 'company_admin', 'ai_bot')).toBe(false);
  });

  it('super_admin ignores feature gates', () => {
    expect(isFeatureEnabled({ ai_bot: false }, 'super_admin', 'ai_bot')).toBe(true);
  });
});
