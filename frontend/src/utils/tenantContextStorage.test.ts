/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getRequestTargetCompanyId,
  getStoredTargetCompanyId,
  setStoredTargetCompany,
  setTenantContextRequestScopeEnabled,
} from './tenantContextStorage';

describe('tenant context request scoping', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setTenantContextRequestScopeEnabled(false);
  });

  it('keeps stored tenant selection out of API requests until platform scope is enabled', () => {
    setStoredTargetCompany('company-1', 'Agency One');

    expect(getStoredTargetCompanyId()).toBe('company-1');
    expect(getRequestTargetCompanyId()).toBeNull();

    setTenantContextRequestScopeEnabled(true);

    expect(getRequestTargetCompanyId()).toBe('company-1');
  });

  it('stops returning request tenant after scope is disabled', () => {
    setStoredTargetCompany('company-2', 'Agency Two');
    setTenantContextRequestScopeEnabled(true);
    expect(getRequestTargetCompanyId()).toBe('company-2');

    setTenantContextRequestScopeEnabled(false);

    expect(getRequestTargetCompanyId()).toBeNull();
  });
});
