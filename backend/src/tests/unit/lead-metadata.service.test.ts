import {
  leadScoreFromConversation,
  mergeLeadMetadata,
  parseLeadMetadata,
} from '../../services/leadMetadata.service';

describe('leadMetadata.service', () => {
  it('parses lead_score and tags', () => {
    const meta = parseLeadMetadata({ lead_score: 'hot', tags: ['vip', 'nri'] });
    expect(meta.lead_score).toBe('hot');
    expect(meta.tags).toEqual(['vip', 'nri']);
  });

  it('computes hot score from conversation signals', () => {
    expect(leadScoreFromConversation(8, 8)).toBe('hot');
    expect(leadScoreFromConversation(6, 6)).toBe('warm');
    expect(leadScoreFromConversation(3, 3)).toBe('cold');
  });

  it('merges metadata patches', () => {
    const merged = mergeLeadMetadata({ tags: ['a'] }, { lead_score: 'warm', tags: ['b'] });
    expect(merged.lead_score).toBe('warm');
    expect(merged.tags).toEqual(['b']);
  });
});
