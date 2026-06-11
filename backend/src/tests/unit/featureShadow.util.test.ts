jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('featureShadow.util', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('shadowCompareSync returns new result when globally enabled and lead in rollout', () => {
    process.env.FEATURE_ADVANCED_LEAD_UX = 'true';
    process.env.FEATURE_ROLLOUT_PERCENTAGE = '100';
    const { shadowCompareSync } = require('../../utils/featureShadow.util');

    const result = shadowCompareSync({
      featureName: 'test',
      featureKey: 'advancedLeadUx',
      leadId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      oldFn: () => 'old',
      newFn: () => 'new',
    });
    expect(result).toBe('new');
  });

  test('shadowCompareSync returns old result when global flag is off', () => {
    process.env.FEATURE_ADVANCED_LEAD_UX = 'false';
    const { shadowCompareSync } = require('../../utils/featureShadow.util');

    const result = shadowCompareSync({
      featureName: 'test',
      featureKey: 'advancedLeadUx',
      leadId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      oldFn: () => ({ buttons: ['a'] }),
      newFn: () => ({ buttons: ['b'] }),
    });
    expect(result).toEqual({ buttons: ['a'] });
  });

  test('shadowCompareSync logs mismatch when rollout excludes lead', () => {
    process.env.FEATURE_ADVANCED_LEAD_UX = 'true';
    process.env.FEATURE_ROLLOUT_PERCENTAGE = '0';
    const logger = require('../../config/logger').default;
    const { shadowCompareSync } = require('../../utils/featureShadow.util');

    const result = shadowCompareSync({
      featureName: 'resolveBuyerComponents',
      featureKey: 'advancedLeadUx',
      leadId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      oldFn: () => ['legacy'],
      newFn: () => ['advanced'],
    });

    expect(result).toEqual(['legacy']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Feature shadow mismatch',
      expect.objectContaining({ featureName: 'resolveBuyerComponents' }),
    );
  });
});
