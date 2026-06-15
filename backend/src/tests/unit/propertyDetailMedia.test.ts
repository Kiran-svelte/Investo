jest.mock('../../services/storage.service', () => ({
  storageService: {
    getPresignedDownloadUrl: jest.fn(async (url: string) => `https://signed.example/${url}`),
  },
  storageUrlRequiresPresignedAccess: jest.fn(() => true),
}));

import { resolvePropertyDetailMediaComponents } from '../../services/brochureDelivery.service';

describe('resolvePropertyDetailMediaComponents', () => {
  it('returns hero image and brochure without explicit brochure keyword', async () => {
    const media = await resolvePropertyDetailMediaComponents({
      companyId: 'co-1',
      property: {
        id: 'prop-1',
        name: 'Sunset Heights 1201',
        brochureUrl: 's3://bucket/brochure.pdf',
        images: ['s3://bucket/hero.jpg'],
      },
    });

    expect(media).toHaveLength(2);
    expect(media[0]?.mime).toMatch(/^image\//);
    expect(media[1]?.mime).toBe('application/pdf');
  });

  it('returns only hero when no brochure on file', async () => {
    const media = await resolvePropertyDetailMediaComponents({
      companyId: 'co-1',
      property: {
        id: 'prop-2',
        name: 'Lake Vista',
        brochureUrl: null,
        images: ['https://cdn.example.com/photo.webp'],
      },
    });

    expect(media).toHaveLength(1);
    expect(media[0]?.mime).toBe('image/webp');
  });
});
