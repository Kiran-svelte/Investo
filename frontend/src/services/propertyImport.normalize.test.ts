import { describe, expect, it } from 'vitest';
import { normalizePropertyImportDraft } from './propertyImport';

describe('normalizePropertyImportDraft', () => {
  it('fills missing mediaAssets and extractionJobs arrays', () => {
    const normalized = normalizePropertyImportDraft({
      id: 'draft-1',
      companyId: 'co-1',
      createdByUserId: 'u-1',
      reviewedByUserId: null,
      publishedPropertyId: null,
      status: 'extracting',
      extractionStatus: 'queued',
      retryCount: 0,
      maxRetries: 3,
      failureReason: null,
      draftData: {},
      reviewNotes: null,
      extractionRequestedAt: null,
      reviewedAt: null,
      publishedAt: null,
      cancelledAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      publishedProperty: null,
    } as any);

    expect(normalized.mediaAssets).toEqual([]);
    expect(normalized.extractionJobs).toEqual([]);
    expect(normalized.mediaAssets.length).toBe(0);
  });
});
