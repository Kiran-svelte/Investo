import {
  buildBuyerQualificationAckReply,
  isBuyerQualificationStatement,
  patchLeadMemoryFromQualification,
} from '../../services/buyerQualification.service';

jest.mock('../../services/buyer-memory-extract.service', () => ({
  extractLeadMemoryDelta: jest.fn().mockReturnValue({
    locationPreference: 'Whitefield',
    budget: { min: 12000000, max: 15000000, currency: 'INR' },
  }),
}));

jest.mock('../../services/lead-memory.service', () => ({
  patchLeadMemory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/clientMemory.service', () => ({
  syncLeadClientMemory: jest.fn().mockResolvedValue(undefined),
}));

import { patchLeadMemory } from '../../services/lead-memory.service';
import { syncLeadClientMemory } from '../../services/clientMemory.service';

describe('buyerQualification H4 qualification fast-path', () => {
  beforeEach(() => jest.clearAllMocks());

  test('detects budget/area/BHK statements', () => {
    expect(isBuyerQualificationStatement('My budget is 1.2 crore for 3BHK in Whitefield')).toBe(true);
    expect(isBuyerQualificationStatement('Interested in villa Whitefield')).toBe(true);
  });

  test('skips explicit intent (falls to H7/H9)', () => {
    expect(isBuyerQualificationStatement('Book a visit Saturday')).toBe(false);
    expect(isBuyerQualificationStatement('Send me the brochure')).toBe(false);
    expect(isBuyerQualificationStatement('What is the price?')).toBe(false);
    expect(isBuyerQualificationStatement('Call me please')).toBe(false);
  });

  test('skips memory-recall questions (H3 not H4)', () => {
    expect(isBuyerQualificationStatement("What's my budget preference?")).toBe(false);
    expect(isBuyerQualificationStatement('What is my location?')).toBe(false);
    expect(isBuyerQualificationStatement('Can you remind me what I said?')).toBe(false);
  });

  test('buildBuyerQualificationAckReply summarizes saved prefs', () => {
    const reply = buildBuyerQualificationAckReply({
      locationPreference: 'Whitefield',
      budget: { min: 12000000, max: 15000000, currency: 'INR' },
    });
    expect(reply).toContain('saved');
    expect(reply).toContain('Whitefield');
    expect(reply).toContain('crore');
  });

  test('patchLeadMemoryFromQualification patches memory and syncs client memory', async () => {
    const delta = await patchLeadMemoryFromQualification('lead-1', '1.2 crore Whitefield 3BHK');
    expect(delta.locationPreference).toBe('Whitefield');
    expect(patchLeadMemory).toHaveBeenCalledWith('lead-1', expect.objectContaining({ locationPreference: 'Whitefield' }));
    expect(syncLeadClientMemory).toHaveBeenCalledWith('lead-1');
  });
});
