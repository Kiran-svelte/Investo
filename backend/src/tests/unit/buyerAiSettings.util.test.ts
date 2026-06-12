/// <reference types="jest" />

const mockFindUnique = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    aiSetting: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

import { BUYER_AI_SETTING_SELECT, loadBuyerAiSettings } from '../../utils/buyerAiSettings.util';

describe('buyerAiSettings.util', () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
  });

  test('loadBuyerAiSettings selects greetingTemplate and defaultLanguage', async () => {
    mockFindUnique.mockResolvedValue({
      greetingTemplate: 'Welcome to {business_name}!',
      greetingMedia: [],
      defaultLanguage: 'hi',
    });

    const settings = await loadBuyerAiSettings('company-1');

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      select: BUYER_AI_SETTING_SELECT,
    });
    expect(settings?.greetingTemplate).toContain('{business_name}');
    expect(settings?.defaultLanguage).toBe('hi');
  });
});
