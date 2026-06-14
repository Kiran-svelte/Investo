import { resolveFirstPropertyHeroMediaComponent } from '../../services/brochureDelivery.service';

jest.mock('../../services/storage.service', () => ({
  storageService: {
    getPresignedDownloadUrl: jest.fn(async (ref: string) => `https://signed.example/${encodeURIComponent(ref)}`),
  },
  storageUrlRequiresPresignedAccess: (url: string) => /amazonaws\.com|\.s3\./i.test(url),
}));

describe('resolveFirstPropertyHeroMediaComponent', () => {
  it('presigns private S3 hero URLs for WhatsApp', async () => {
    const s3Url =
      'https://biginvesto.s3.eu-north-1.amazonaws.com/investo/companies/x/properties/y/image/photo.jpg';
    const media = await resolveFirstPropertyHeroMediaComponent({
      images: [s3Url],
      caption: 'Sunset Heights 1102',
    });
    expect(media).not.toBeNull();
    expect(media!.kind).toBe('media');
    expect(media!.url).toContain('signed.example');
    expect(media!.caption).toBe('Sunset Heights 1102');
  });

  it('returns null when images array is empty', async () => {
    expect(await resolveFirstPropertyHeroMediaComponent({ images: [] })).toBeNull();
  });

  it('does not send raw private S3 URLs when presign fails', async () => {
    const { storageService } = await import('../../services/storage.service');
    (storageService.getPresignedDownloadUrl as jest.Mock).mockRejectedValueOnce(new Error('denied'));
    const media = await resolveFirstPropertyHeroMediaComponent({
      images: ['https://biginvesto.s3.eu-north-1.amazonaws.com/investo/companies/x/properties/y/image/photo.jpg'],
    });
    expect(media).toBeNull();
  });
});
