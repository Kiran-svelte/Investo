import {
  DEFAULT_CONVERSION_SETTINGS,
  mergeCompanyConversionSettings,
  parseConversionSettings,
  getBudgetStretchRatio,
} from '../../services/conversionSettings.service';

describe('conversionSettings.service', () => {
  test('parseConversionSettings applies defaults', () => {
    const s = parseConversionSettings({});
    expect(s.budget_stretch_percent).toBe(15);
    expect(s.upsell_enabled).toBe(true);
    expect(s.partners).toEqual([]);
    expect(s.waitlist_copy.en).toContain('waitlist');
  });

  test('mergeCompanyConversionSettings clamps stretch percent', () => {
    const merged = mergeCompanyConversionSettings({}, { budget_stretch_percent: 99 });
    const parsed = parseConversionSettings(merged);
    expect(parsed.budget_stretch_percent).toBe(50);
  });

  test('getBudgetStretchRatio', () => {
    expect(getBudgetStretchRatio({ ...DEFAULT_CONVERSION_SETTINGS, budget_stretch_percent: 20 })).toBe(
      0.2,
    );
  });

  test('parseConversionSettings reads partners', () => {
    const s = parseConversionSettings({
      conversion: {
        partners: [{ id: 'p1', name: 'Builder A', active: true }],
      },
    });
    expect(s.partners).toHaveLength(1);
    expect(s.partners[0].name).toBe('Builder A');
  });
});
