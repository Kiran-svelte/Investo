import { Prisma, type Lead } from '@prisma/client';

const mockGetConversionSettings = jest.fn();
const mockSearchExactProperties = jest.fn();
const mockSearchAlternativeTiers = jest.fn();
const mockFormatAlternativesForPrompt = jest.fn();
const mockCriteriaFromLead = jest.fn();
const mockCalculateEmi = jest.fn();

jest.mock('../../services/conversionSettings.service', () => ({
  getConversionSettings: (...args: unknown[]) => mockGetConversionSettings(...args),
}));

jest.mock('../../services/alternativeInventory.service', () => ({
  criteriaFromLead: (...args: unknown[]) => mockCriteriaFromLead(...args),
  formatAlternativesForPrompt: (...args: unknown[]) => mockFormatAlternativesForPrompt(...args),
  searchAlternativeTiers: (...args: unknown[]) => mockSearchAlternativeTiers(...args),
  searchExactProperties: (...args: unknown[]) => mockSearchExactProperties(...args),
}));

jest.mock('../../services/emi.service', () => ({
  calculateEmi: (...args: unknown[]) => mockCalculateEmi(...args),
}));

import { buildConversionContext } from '../../services/conversionEngine.service';

const baseLead: Partial<Lead> = {
  id: 'lead-1',
  companyId: 'company-1',
  budgetMin: new Prisma.Decimal(3000000),
  budgetMax: new Prisma.Decimal(5000000),
  locationPreference: 'Pune',
};

describe('buildConversionContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConversionSettings.mockResolvedValue({
      budget_stretch_percent: 15,
      upsell_enabled: true,
    });
    mockCriteriaFromLead.mockReturnValue({
      companyId: 'company-1',
      budgetMin: 3000000,
      budgetMax: 5000000,
    });
    mockFormatAlternativesForPrompt.mockReturnValue('## PROPERTIES\n- Property A');
    mockCalculateEmi.mockReturnValue({ monthlyEmi: 45000 });
  });

  test('returns exact property IDs when exact matches are found', async () => {
    mockSearchExactProperties.mockResolvedValue([{ id: 'prop-1' }, { id: 'prop-2' }]);
    mockSearchAlternativeTiers.mockResolvedValue([]);

    const result = await buildConversionContext(baseLead as Lead);

    expect(result.exactPropertyIds).toEqual(['prop-1', 'prop-2']);
    expect(result.alternativePropertyIds).toEqual([]);
    expect(mockSearchAlternativeTiers).not.toHaveBeenCalled();
  });

  test('searches alternatives when no exact matches found', async () => {
    mockSearchExactProperties.mockResolvedValue([]);
    mockSearchAlternativeTiers.mockResolvedValue([
      { tier: 'stretch', properties: [{ id: 'alt-1' }, { id: 'alt-2' }] },
    ]);

    const result = await buildConversionContext(baseLead as Lead);

    expect(result.exactPropertyIds).toEqual([]);
    expect(result.alternativePropertyIds).toEqual(['alt-1', 'alt-2']);
    expect(mockSearchAlternativeTiers).toHaveBeenCalledTimes(1);
  });

  test('deduplicates alternative property IDs', async () => {
    mockSearchExactProperties.mockResolvedValue([]);
    mockSearchAlternativeTiers.mockResolvedValue([
      { tier: 'stretch', properties: [{ id: 'alt-1' }, { id: 'alt-1' }] },
      { tier: 'upsell', properties: [{ id: 'alt-2' }, { id: 'alt-1' }] },
    ]);

    const result = await buildConversionContext(baseLead as Lead);

    expect(result.alternativePropertyIds).toEqual(['alt-1', 'alt-2']);
  });

  test('adds EMI snippet when alternatives exist and lead budget is below cheapest price', async () => {
    mockSearchExactProperties.mockResolvedValue([]);
    mockSearchAlternativeTiers.mockResolvedValue([
      { tier: 'stretch', properties: [{ id: 'alt-1', priceMin: new Prisma.Decimal(6000000) }] },
    ]);
    mockCalculateEmi.mockReturnValue({ monthlyEmi: 45000 });

    const leadWithBudget = { ...baseLead, budgetMax: new Prisma.Decimal(5000000) } as Lead;
    const result = await buildConversionContext(leadWithBudget);

    expect(result.emiSnippet).not.toBeNull();
    expect(result.emiSnippet).toContain('EMI estimate');
    expect(result.promptBlock).toContain('EMI BRIDGE');
  });

  test('no EMI snippet when exact properties are found', async () => {
    mockSearchExactProperties.mockResolvedValue([{ id: 'prop-1' }]);

    const result = await buildConversionContext(baseLead as Lead);

    expect(result.emiSnippet).toBeNull();
    expect(mockCalculateEmi).not.toHaveBeenCalled();
  });

  test('passes budget_stretch_percent from conversion settings to criteria', async () => {
    mockGetConversionSettings.mockResolvedValue({
      budget_stretch_percent: 20,
      upsell_enabled: false,
    });
    mockSearchExactProperties.mockResolvedValue([]);
    mockSearchAlternativeTiers.mockResolvedValue([]);

    await buildConversionContext(baseLead as Lead);

    expect(mockSearchAlternativeTiers).toHaveBeenCalledWith(
      expect.objectContaining({ budgetStretchPercent: 20 }),
    );
  });
});
