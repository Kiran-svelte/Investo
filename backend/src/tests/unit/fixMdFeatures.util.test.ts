/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: {
      fixMdReturningBuyerStage: true,
      advancedLeadUx: true,
      rolloutPercentage: 0,
    },
  },
}));

import { shouldElevateReturningBuyerStage, isFixMdEnabled } from '../../utils/fixMdFeatures.util';

describe('fixMdFeatures.util', () => {
  test('fixMdReturningBuyerStage is enabled by default', () => {
    expect(isFixMdEnabled('fixMdReturningBuyerStage')).toBe(true);
  });

  test('shouldElevateReturningBuyerStage bypasses rollout when fix flag ON', () => {
    expect(shouldElevateReturningBuyerStage(undefined)).toBe(true);
    expect(shouldElevateReturningBuyerStage('lead-outside-rollout')).toBe(true);
  });
});

describe('fixMdFeatures.util with flag OFF', () => {
  beforeAll(() => {
    const config = require('../../config').default;
    config.features.fixMdReturningBuyerStage = false;
    config.features.rolloutPercentage = 0;
  });

  test('falls back to advancedLeadUx rollout bucket', () => {
    expect(shouldElevateReturningBuyerStage(undefined)).toBe(false);
  });
});
