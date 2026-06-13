import config from '../../config';
import {
  extractExtendedPropertyAttributes,
  formatExtendedAttributesForPrompt,
} from '../../utils/extractExtendedPropertyAttributes.util';
import { shouldBlockPublishForImportReview } from '../../services/propertyImport.metadata';
import { wasKnowledgeEmbeddingDegraded } from '../../services/propertyKnowledge.service';
import { isPropertyDetailQuestion } from '../../services/customerMessageFastPath.service';

describe('extractExtendedPropertyAttributes.util', () => {
  test('extracts non-catalog import fields', () => {
    const attrs = extractExtendedPropertyAttributes({
      name: 'Lake Vista',
      builder: 'Horizon',
      carpet_area_sqft: 1450,
      possession_date: 'Dec 2027',
      facing: 'East',
      maintenance_monthly: 4500,
    });
    expect(attrs.carpet_area_sqft).toBe(1450);
    expect(attrs.possession_date).toBe('Dec 2027');
    expect(attrs.facing).toBe('East');
    expect(attrs.name).toBeUndefined();
    expect(attrs.builder).toBeUndefined();
  });

  test('formatExtendedAttributesForPrompt uses human labels', () => {
    const text = formatExtendedAttributesForPrompt({
      carpet_area_sqft: 1200,
      facing: 'North',
    });
    expect(text).toContain('Carpet area (sq ft): 1200');
    expect(text).toContain('Facing direction: North');
  });
});

describe('shouldBlockPublishForImportReview', () => {
  const original = config.features.bulkImportSkipReview;

  afterEach(() => {
    config.features.bulkImportSkipReview = original;
  });

  test('skips review block for bulk_csv when flag on', () => {
    config.features.bulkImportSkipReview = true;
    expect(shouldBlockPublishForImportReview({
      import_mode: 'bulk_csv',
      import_review: { status: 'needs_review' },
    })).toBe(false);
  });
});

describe('buyer experience helpers', () => {
  test('isPropertyDetailQuestion recognizes carpet area questions', () => {
    expect(isPropertyDetailQuestion('What is the carpet area for Lake Vista?')).toBe(true);
  });

  test('wasKnowledgeEmbeddingDegraded defaults false before embeddings', () => {
    expect(wasKnowledgeEmbeddingDegraded()).toBe(false);
  });
});
