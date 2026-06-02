import { describe, expect, it } from 'vitest';
import {
  getRoleHomePath,
  getNavItemForPath,
  getVisibleNavItems,
  isPathAllowedForRole,
} from './navigation.config';

describe('navigation.config', () => {
  const allFeatures = () => true;

  it('super_admin home is companies', () => {
    expect(getRoleHomePath('super_admin')).toBe('/companies');
  });

  it('super_admin does not see tenant leads in nav', () => {
    const items = getVisibleNavItems('super_admin', allFeatures);
    expect(items.some((i) => i.key === 'leads')).toBe(false);
    expect(items.some((i) => i.key === 'companies')).toBe(true);
  });

  it('company_admin sees full tenant nav', () => {
    const items = getVisibleNavItems('company_admin', allFeatures);
    expect(items.map((i) => i.key)).toEqual(
      expect.arrayContaining(['dashboard', 'leads', 'agents', 'ai_settings', 'billing']),
    );
    expect(items.some((i) => i.key === 'companies')).toBe(false);
  });

  it('blocks super_admin from tenant leads URL', () => {
    expect(isPathAllowedForRole('/leads', 'super_admin', allFeatures)).toBe(false);
    expect(isPathAllowedForRole('/companies', 'super_admin', allFeatures)).toBe(true);
  });

  it('allows sales_agent leads but not agents page', () => {
    expect(isPathAllowedForRole('/leads', 'sales_agent', allFeatures)).toBe(true);
    expect(isPathAllowedForRole('/agents', 'sales_agent', allFeatures)).toBe(false);
  });

  it('property import is company_admin only', () => {
    const spec = getNavItemForPath('/properties/import');
    expect(spec?.roles).toEqual(['company_admin']);
  });
});
