jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    ai: {
      openaiApiKey: 'test-openai-key',
      openaiModel: 'gpt-4o',
    },
  },
}));

import { PropertyImportExtractorService } from '../../services/propertyImportExtractor.service';

describe('PropertyImportExtractorService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('parses brochure pdf text and returns structured extraction data', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from('pdf-bytes'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  structuredData: {
                    name: 'Sunrise Residences',
                    builder: 'Acme Builders',
                    location_city: 'Bengaluru',
                    price_min: 8500000,
                    price_max: 12500000,
                    bedrooms: 3,
                    property_type: 'apartment',
                    amenities: ['Pool', 'Gym'],
                    description: 'Premium homes near Whitefield',
                    rera_number: 'PRM/KA/RERA/1234',
                    status: 'available',
                  },
                  confidenceHints: [
                    {
                      field: 'name',
                      confidence: 0.95,
                      source_field: 'header',
                      note: 'Brochure heading',
                    },
                  ],
                  reviewRequired: true,
                  metadata: {
                    summary: 'Structured property brochure',
                  },
                }),
              },
            },
          ],
        }),
      });

    global.fetch = fetchMock as any;

    const extractor = new PropertyImportExtractorService({
      fetch: fetchMock as any,
      pdfParse: async () => ({
        text: [
          'Sunrise Residences',
          'Acme Builders',
          '3 BHK premium homes in Bengaluru',
          'Price starting ₹85 Lakhs',
          'RERA: PRM/KA/RERA/1234',
        ].join('\n'),
      }),
    });

    const result = await extractor.extractMedia({
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-1',
      media: {
        assetType: 'brochure',
        mimeType: 'application/pdf',
        fileName: 'sunrise-brochure.pdf',
        fileSize: 1024,
        storageKey: 'companies/company-1/properties/draft-1/brochure/file.pdf',
        publicUrl: 'https://cdn.example.com/file.pdf',
      },
      draftData: {},
    });

    expect(result).not.toBeNull();
    expect(result?.structuredData).toMatchObject({
      name: 'Sunrise Residences',
      builder: 'Acme Builders',
      location_city: 'Bengaluru',
      price_min: 8500000,
      price_max: 12500000,
      bedrooms: 3,
      property_type: 'apartment',
      rera_number: 'PRM/KA/RERA/1234',
      status: 'available',
    });
    expect(result?.reviewRequired).toBe(true);
    expect(result?.metadata).toMatchObject({
      sourceType: 'openai',
      fileName: 'sunrise-brochure.pdf',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('uses OpenAI vision for brochure images and returns multi-unit payload', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                structuredData: {
                  name: 'Palm Grove',
                  location_city: 'Bengaluru',
                  property_type: 'villa',
                },
                units: [
                  { label: 'Villa A', name: 'Villa A', bedrooms: 3, price_min: 12000000 },
                  { label: 'Villa B', name: 'Villa B', bedrooms: 4, price_min: 15000000 },
                ],
                confidenceHints: [{ field: 'name', confidence: 0.9 }],
                reviewRequired: true,
              }),
            },
          },
        ],
      }),
    });

    global.fetch = fetchMock as any;

    const extractor = new PropertyImportExtractorService({
      fetch: fetchMock as any,
      storage: {
        getObjectBuffer: async () => Buffer.from('fake-image'),
      },
    });

    const result = await extractor.extractMedia({
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-1',
      media: {
        assetType: 'image',
        mimeType: 'image/jpeg',
        fileName: 'palm-grove.jpg',
        fileSize: 2048,
        storageKey: 'companies/company-1/properties/draft-1/image/file.jpg',
        publicUrl: 'https://cdn.example.com/file.jpg',
      },
      draftData: {},
    });

    expect(result?.units).toHaveLength(2);
    expect(result?.metadata).toMatchObject({
      sourceType: 'openai_vision',
      unitsCount: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('falls back to filename heuristics when brochure text is unavailable', async () => {
    const extractor = new PropertyImportExtractorService({
      fetch: jest.fn(async () => ({ ok: false, status: 404 })) as any,
      pdfParse: async () => ({ text: '' }),
    });

    const result = await extractor.extractMedia({
      companyId: 'company-1',
      draftId: 'draft-1',
      mediaId: 'media-1',
      media: {
        assetType: 'brochure',
        mimeType: 'application/pdf',
        fileName: 'sunrise-brochure.pdf',
        fileSize: 1024,
        storageKey: 'companies/company-1/properties/draft-1/brochure/file.pdf',
        publicUrl: 'https://cdn.example.com/file.pdf',
      },
      draftData: {},
    });

    expect(result?.structuredData.name).toBe('Sunrise Brochure');
    expect(result?.reviewRequired).toBe(true);
  });
});