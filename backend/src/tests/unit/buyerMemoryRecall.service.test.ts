import {
  buildBuyerMemoryRecallReply,
  isBuyerMemoryRecallQuery,
} from '../../services/buyerMemoryRecall.service';

jest.mock('../../services/lead-memory.service', () => ({
  getLeadMemory: jest.fn(),
}));

import { getLeadMemory } from '../../services/lead-memory.service';

describe('buyerMemoryRecall.service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('detects budget recall questions', () => {
    expect(isBuyerMemoryRecallQuery("What's my budget preference?")).toBe(true);
    expect(isBuyerMemoryRecallQuery('Book a visit Saturday')).toBe(false);
    expect(isBuyerMemoryRecallQuery('My budget is 1.2 to 1.5 crore for 3BHK')).toBe(false);
  });

  it('recalls budget and location from lead_memory', async () => {
    (getLeadMemory as jest.Mock).mockResolvedValue({
      budget: { min: 12000000, max: 15000000, currency: 'INR' },
      locationPreference: 'Whitefield',
    });
    const reply = await buildBuyerMemoryRecallReply('lead-1');
    expect(reply).toContain('1.20 crore');
    expect(reply).toContain('Whitefield');
  });
});
