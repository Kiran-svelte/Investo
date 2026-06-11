describe('featureRollout.util', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('stableLeadHashBucket is stable and within 0-99', () => {
    const { stableLeadHashBucket } = require('../../utils/featureRollout.util');
    const leadId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(stableLeadHashBucket(leadId)).toBe(stableLeadHashBucket(leadId));
    expect(stableLeadHashBucket(leadId)).toBeGreaterThanOrEqual(0);
    expect(stableLeadHashBucket(leadId)).toBeLessThan(100);
  });

  test('isFeatureEnabledForLead requires global flag and rollout bucket', () => {
    process.env.FEATURE_ADVANCED_LEAD_UX = 'true';
    process.env.FEATURE_ROLLOUT_PERCENTAGE = '100';
    const { isFeatureEnabledForLead } = require('../../utils/featureRollout.util');
    expect(
      isFeatureEnabledForLead('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'advancedLeadUx'),
    ).toBe(true);

    process.env.FEATURE_ADVANCED_LEAD_UX = 'false';
    jest.resetModules();
    const mod = require('../../utils/featureRollout.util');
    expect(mod.isFeatureEnabledForLead('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'advancedLeadUx')).toBe(false);
  });

  test('rollout percentage 0 disables all leads', () => {
    process.env.FEATURE_ADVANCED_LEAD_UX = 'true';
    process.env.FEATURE_ROLLOUT_PERCENTAGE = '0';
    const { isFeatureEnabledForLead } = require('../../utils/featureRollout.util');
    expect(
      isFeatureEnabledForLead('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'advancedLeadUx'),
    ).toBe(false);
  });
});
