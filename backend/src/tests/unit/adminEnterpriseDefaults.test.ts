/// <reference types="jest" />

describe('admin enterprise feature defaults', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.FEATURE_TENANT_QUOTAS;
    delete process.env.FEATURE_PUBLIC_API;
    delete process.env.FEATURE_DSR;
    delete process.env.FEATURE_COMPLIANCE_RETENTION;
    delete process.env.FEATURE_COMPLIANCE_LEGAL_HOLD;
    delete process.env.FEATURE_COMPLIANCE_DPA;
    delete process.env.FEATURE_SSO;
    delete process.env.FEATURE_MFA;
    delete process.env.FEATURE_SCIM;
    delete process.env.FEATURE_ORG_BRANCHES;
    delete process.env.FEATURE_IP_ALLOWLIST;
    delete process.env.FEATURE_PROMPT_VERSIONING;
    delete process.env.FEATURE_AI_REVIEW_QUEUE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('enables admin dashboard modules by default', () => {
    const { default: config } = require('../../config');
    expect(config.features.tenantQuotas).toBe(true);
    expect(config.features.publicApi).toBe(true);
    expect(config.features.dsr).toBe(true);
    expect(config.features.complianceRetention).toBe(true);
    expect(config.features.complianceLegalHold).toBe(true);
    expect(config.features.complianceDpa).toBe(true);
    expect(config.features.sso).toBe(false);
    expect(config.features.mfa).toBe(true);
    expect(config.features.scim).toBe(true);
    expect(config.features.orgBranches).toBe(true);
    expect(config.features.ipAllowlist).toBe(true);
    expect(config.features.promptVersioning).toBe(true);
    expect(config.features.aiReviewQueue).toBe(true);
  });

  it('supports kill switches via FEATURE_*=false', () => {
    process.env.FEATURE_PUBLIC_API = 'false';
    process.env.FEATURE_AI_REVIEW_QUEUE = 'false';
    const { default: config } = require('../../config');
    expect(config.features.publicApi).toBe(false);
    expect(config.features.aiReviewQueue).toBe(false);
    expect(config.features.dsr).toBe(true);
  });
});
