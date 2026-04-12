const mockPrisma = {
  propertyImportMediaBlob: {
    findUnique: jest.fn(),
  },
} as any;

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { storageService } from '../../services/storage.service';

describe('StorageService db-backed property import media keys', () => {
  const mediaId = '550e8400-e29b-41d4-a716-446655440000';
  const dbKey = `db/property-import-media/${mediaId}`;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('verifyUploadedObject returns exists=true with metadata for db keys', async () => {
    mockPrisma.propertyImportMediaBlob.findUnique.mockResolvedValue({
      mediaId,
      companyId: '550e8400-e29b-41d4-a716-446655440001',
      mimeType: 'application/pdf',
      fileSize: 3,
      bytes: Buffer.from('pdf'),
    });

    await expect(
      storageService.verifyUploadedObject(dbKey, { mimeType: 'application/pdf', fileSize: 3 }),
    ).resolves.toEqual({
      exists: true,
      contentType: 'application/pdf',
      contentLength: 3,
      eTag: undefined,
    });

    expect(mockPrisma.propertyImportMediaBlob.findUnique).toHaveBeenCalledWith({
      where: { mediaId },
      select: {
        mimeType: true,
        fileSize: true,
      },
    });
  });

  test('verifyUploadedObject returns exists=false when blob is missing', async () => {
    mockPrisma.propertyImportMediaBlob.findUnique.mockResolvedValue(null);

    await expect(storageService.verifyUploadedObject(dbKey, { mimeType: 'application/pdf', fileSize: 3 })).resolves.toEqual({
      exists: false,
    });
  });

  test('verifyUploadedObject throws a 409-style error on file size mismatch for db keys', async () => {
    mockPrisma.propertyImportMediaBlob.findUnique.mockResolvedValue({
      mediaId,
      companyId: '550e8400-e29b-41d4-a716-446655440001',
      mimeType: 'application/pdf',
      fileSize: 4,
    });

    await expect(storageService.verifyUploadedObject(dbKey, { mimeType: 'application/pdf', fileSize: 3 })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  test('getObjectBuffer returns the stored bytes for db keys', async () => {
    mockPrisma.propertyImportMediaBlob.findUnique.mockResolvedValue({
      mediaId,
      bytes: Buffer.from('hello'),
    });

    await expect(storageService.getObjectBuffer(dbKey)).resolves.toEqual(Buffer.from('hello'));

    expect(mockPrisma.propertyImportMediaBlob.findUnique).toHaveBeenCalledWith({
      where: { mediaId },
      select: {
        bytes: true,
      },
    });
  });
});
