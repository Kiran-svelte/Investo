/// <reference types="jest" />

import {
  applyImageImportAutoFlow,
  IMAGE_AUTO_FLOW_MODE,
  isImageAutoImportFlow,
  isImageOnlyPropertyImportMedia,
} from '../../utils/propertyImportAutoFlow.util';

describe('propertyImportAutoFlow.util', () => {
  test('detects image-only media', () => {
    expect(isImageOnlyPropertyImportMedia([
      { assetType: 'image', mimeType: 'image/png' },
      { assetType: 'image', mimeType: 'image/jpeg' },
    ])).toBe(true);
    expect(isImageOnlyPropertyImportMedia([
      { assetType: 'image', mimeType: 'image/png' },
      { assetType: 'brochure', mimeType: 'application/pdf' },
    ])).toBe(false);
  });

  test('auto flow approves review and skips knowledge for image uploads with extracted identity', () => {
    const result = applyImageImportAutoFlow(
      {
        name: 'Sunset Heights',
        property_type: 'apartment',
        bedrooms: 3,
        price_min: 8500000,
        location_area: 'Whitefield',
      },
      [{ assetType: 'image', mimeType: 'image/png' }],
    );

    expect(result.import_flow_mode).toBe(IMAGE_AUTO_FLOW_MODE);
    expect((result.import_review as { status?: string }).status).toBe('approved');
    expect((result.type_knowledge as Record<string, string>).anything_else_skipped).toBe('true');
    expect(isImageAutoImportFlow(result)).toBe(true);
  });

  test('does not auto flow when identity is missing', () => {
    const result = applyImageImportAutoFlow(
      { property_type: 'apartment' },
      [{ assetType: 'image', mimeType: 'image/png' }],
    );
    expect(result.import_flow_mode).toBeUndefined();
  });
});
