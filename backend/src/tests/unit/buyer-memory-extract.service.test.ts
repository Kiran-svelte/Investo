const mockGetLeadMemory = jest.fn();
const mockPatchLeadMemory = jest.fn();

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/lead-memory.service', () => ({
  getLeadMemory: (...args: unknown[]) => mockGetLeadMemory(...args),
  patchLeadMemory: (...args: unknown[]) => mockPatchLeadMemory(...args),
}));

import {
  extractLeadMemoryDelta,
  extractAndPatchLeadMemory,
  inferBuyerWorkflowIdFromMessage,
} from '../../services/buyer-memory-extract.service';

describe('buyer-memory-extract.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLeadMemory.mockResolvedValue({ version: 1, updatedAt: new Date().toISOString() });
    mockPatchLeadMemory.mockResolvedValue(undefined);
  });

  it('extracts projectsDiscussed from brochure outbound text', () => {
    const delta = extractLeadMemoryDelta({
      leadId: 'lead-1',
      messageText: 'send me the brochure',
      outboundText: 'Here is the *Sunset Heights* brochure with floor plans. Price starts from 2 Cr.',
      workflowId: 'brochure_request',
    });

    expect(delta.projectsDiscussed).toEqual([
      { name: 'Sunset Heights', factsShown: ['price', 'brochure'] },
    ]);
    expect(delta.lastIntent).toBe('brochure_request');
  });

  it('extracts upcomingVisits from visit commit snapshot', () => {
    const scheduledAt = new Date('2026-06-10T10:00:00.000Z');
    const delta = extractLeadMemoryDelta({
      leadId: 'lead-1',
      messageText: 'book visit tomorrow 10am',
      outboundText: 'Your visit is confirmed.',
      visitCommit: {
        committed: true,
        visitId: 'visit-99',
        scheduledAt,
        mode: 'scheduled',
        propertyName: 'Palm Grove',
      },
    });

    expect(delta.upcomingVisits).toEqual([
      {
        visitId: 'visit-99',
        propertyName: 'Palm Grove',
        scheduledAt: scheduledAt.toISOString(),
        status: 'scheduled',
      },
    ]);
  });

  it('extracts budget range from buyer message', () => {
    const delta = extractLeadMemoryDelta({
      leadId: 'lead-1',
      messageText: 'My budget is 1.5 to 2 Cr',
      outboundText: 'Noted your budget range.',
    });

    expect(delta.budget).toEqual({
      min: 15_000_000,
      max: 20_000_000,
      currency: 'INR',
    });
  });

  it('infers workflow ids from buyer phrasing', () => {
    expect(inferBuyerWorkflowIdFromMessage('push my appointment later')).toBe('reschedule_visit');
    expect(inferBuyerWorkflowIdFromMessage('send brochure pdf')).toBe('brochure_request');
    expect(inferBuyerWorkflowIdFromMessage('hello there')).toBeNull();
  });

  it('extractAndPatchLeadMemory merges projects without overwriting prior mentions', async () => {
    mockGetLeadMemory.mockResolvedValue({
      version: 1,
      updatedAt: new Date().toISOString(),
      projectsDiscussed: [{ name: 'Old Tower', factsShown: ['price'] }],
    });

    await extractAndPatchLeadMemory({
      leadId: 'lead-1',
      messageText: 'brochure please',
      outboundText: '*New Heights* brochure attached.',
      workflowId: 'brochure_request',
    });

    expect(mockPatchLeadMemory).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({
        projectsDiscussed: [
          { name: 'Old Tower', factsShown: ['price'] },
          { name: 'New Heights', factsShown: ['brochure'] },
        ],
      }),
    );
  });
});
