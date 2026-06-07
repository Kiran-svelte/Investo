import { getUnifiedLeadMemory, buildUnifiedMemoryContextBlock } from '../../services/unifiedMemory.service';

jest.mock('../../services/lead-memory.service', () => ({
  getLeadMemory: jest.fn(),
  buildPromptMemoryBlock: jest.fn(),
}));
jest.mock('../../services/liveLeadContext.service', () => ({
  getLiveLeadContext: jest.fn(),
}));
jest.mock('../../services/conversation-summary.service', () => ({
  buildConversationContextBlock: jest.fn(),
}));

import { getLeadMemory, buildPromptMemoryBlock } from '../../services/lead-memory.service';
import { getLiveLeadContext } from '../../services/liveLeadContext.service';
import { buildConversationContextBlock } from '../../services/conversation-summary.service';

describe('unifiedMemory.service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prefers live CRM visit (freshness) over the extracted structured blob', async () => {
    const justBooked = new Date(Date.now() + 60 * 60 * 1000);
    (getLeadMemory as jest.Mock).mockResolvedValue({
      version: 1,
      updatedAt: new Date().toISOString(),
      budget: { min: 12000000, max: 15000000, currency: 'INR' },
      locationPreference: 'Whitefield',
      upcomingVisits: [
        { visitId: 'stale-visit', propertyName: 'Old Project', scheduledAt: '2020-01-01T00:00:00Z', status: 'scheduled' },
      ],
    });
    (getLiveLeadContext as jest.Mock).mockResolvedValue({
      leadStatus: 'visit_scheduled',
      leadName: 'Asha',
      activeVisit: {
        visitId: 'fresh-visit',
        propertyId: 'p1',
        propertyName: 'Lake Vista',
        status: 'scheduled',
        scheduledAt: justBooked,
        agentName: null,
        agentPhone: null,
        notes: null,
      },
      recentCompletedVisit: null,
      assignedAgentName: null,
      assignedAgentPhone: null,
      promptBlock: 'LIVE',
    });

    const unified = await getUnifiedLeadMemory('lead-1', 'company-1');

    expect(unified.resolved.upcomingVisits).toHaveLength(1);
    expect(unified.resolved.upcomingVisits[0].visitId).toBe('fresh-visit');
    expect(unified.resolved.status).toBe('visit_scheduled');
    // Budget/location come from the canonical structured blob.
    expect(unified.resolved.budget?.min).toBe(12000000);
    expect(unified.resolved.locationPreference).toBe('Whitefield');
  });

  it('falls back to structured visits when no live snapshot is available', async () => {
    (getLeadMemory as jest.Mock).mockResolvedValue({
      version: 1,
      updatedAt: new Date().toISOString(),
      upcomingVisits: [
        { visitId: 'v-struct', propertyName: 'Maple', scheduledAt: '2030-01-01T00:00:00Z', status: 'confirmed' },
      ],
    });

    const unified = await getUnifiedLeadMemory('lead-2');

    expect(unified.live).toBeNull();
    expect(unified.resolved.status).toBe('unknown');
    expect(unified.resolved.upcomingVisits[0].visitId).toBe('v-struct');
  });

  it('composes prompt blocks through one entrypoint', async () => {
    (buildPromptMemoryBlock as jest.Mock).mockResolvedValue('## Lead memory (known facts)\n- Budget: x');
    (buildConversationContextBlock as jest.Mock).mockResolvedValue('## Recent context\n- foo');

    const { leadMemoryBlock, conversationContextBlock } = await buildUnifiedMemoryContextBlock({
      leadId: 'lead-3',
      conversationId: 'conv-3',
      companyId: 'company-1',
    });

    expect(leadMemoryBlock).toContain('Lead memory');
    expect(conversationContextBlock).toContain('Recent context');
    expect(buildConversationContextBlock).toHaveBeenCalledWith('conv-3', 'lead-3', 'company-1');
  });

  it('skips conversation block when no conversationId', async () => {
    (buildPromptMemoryBlock as jest.Mock).mockResolvedValue('## Lead memory (known facts)');

    const { conversationContextBlock } = await buildUnifiedMemoryContextBlock({ leadId: 'lead-4' });

    expect(conversationContextBlock).toBe('');
    expect(buildConversationContextBlock).not.toHaveBeenCalled();
  });
});
