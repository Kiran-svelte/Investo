/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockTx = {
  propertyImportMedia: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  propertyImportMediaBlob: {
    create: jest.Mock;
  };
};

type MockPrisma = {
  $transaction: jest.Mock;
  $executeRawUnsafe: jest.Mock;
};

function createUploadApp(options?: { firstTransactionError?: any }): { app: Express; mockPrisma: MockPrisma; mockTx: MockTx } {
  jest.resetModules();

  const mockTx: MockTx = {
    propertyImportMedia: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    propertyImportMediaBlob: {
      create: jest.fn(),
    },
  };

  const mockPrisma: MockPrisma = {
    $transaction: jest.fn(async (fn: any) => fn(mockTx)),
    $executeRawUnsafe: jest.fn(),
  };

  if (options?.firstTransactionError) {
    mockPrisma.$transaction.mockImplementationOnce(async () => {
      throw options.firstTransactionError;
    });
  }

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: {
      storage: {
        propertyUploadMaxBytes: 50 * 1024 * 1024,
      },
    },
  }));

  let uploadRoutes: any;
  jest.isolateModules(() => {
    uploadRoutes = require('../../routes/property-import-upload.routes').default;
  });

  const app = express();
  app.use('/', uploadRoutes);

  return { app, mockPrisma, mockTx };
}

describe('property import upload routes (DB-backed)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('uploads bytes and marks media as uploaded', async () => {
    const { app, mockTx } = createUploadApp();

    const uploadToken = 'token-123';
    const mediaId = '550e8400-e29b-41d4-a716-446655440000';
    const companyId = '550e8400-e29b-41d4-a716-446655440001';

    mockTx.propertyImportMedia.findUnique.mockResolvedValue({
      id: mediaId,
      companyId,
      status: 'upload_requested',
      mimeType: 'application/pdf',
      storageKey: `db/property-import-media/${mediaId}`,
    });

    mockTx.propertyImportMediaBlob.create.mockResolvedValue({ mediaId });
    mockTx.propertyImportMedia.update.mockResolvedValue({ id: mediaId, status: 'uploaded' });

    const response = await request(app)
      .put(`/${uploadToken}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('pdf'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    expect(mockTx.propertyImportMediaBlob.create).toHaveBeenCalledTimes(1);
    const blobArg = mockTx.propertyImportMediaBlob.create.mock.calls[0][0];
    expect(blobArg.data).toEqual(
      expect.objectContaining({
        mediaId,
        companyId,
        mimeType: 'application/pdf',
        fileSize: 3,
      }),
    );
    expect(blobArg.data.bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(blobArg.data.bytes).toString('utf8')).toBe('pdf');

    expect(mockTx.propertyImportMedia.update).toHaveBeenCalledWith({
      where: { id: mediaId },
      data: expect.objectContaining({
        status: 'uploaded',
        failureReason: null,
      }),
    });
  });

  test('returns 409 when token is not DB-backed', async () => {
    const { app, mockTx } = createUploadApp();

    mockTx.propertyImportMedia.findUnique.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      companyId: '550e8400-e29b-41d4-a716-446655440001',
      status: 'upload_requested',
      mimeType: 'application/pdf',
      storageKey: 'companies/x/properties/y/brochure/file.pdf',
    });

    const response = await request(app)
      .put('/token-456')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('pdf'));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'Direct upload is not available for this token' });
  });

  test('self-heals when blob table is missing and retries upload', async () => {
    const tableMissingError = {
      code: 'P2021',
      message: 'The table `public.property_import_media_blobs` does not exist in the current database.',
    };

    const { app, mockPrisma, mockTx } = createUploadApp({ firstTransactionError: tableMissingError });

    const uploadToken = 'token-789';
    const mediaId = '550e8400-e29b-41d4-a716-446655440000';

    mockTx.propertyImportMedia.findUnique.mockResolvedValue({
      id: mediaId,
      companyId: '550e8400-e29b-41d4-a716-446655440001',
      status: 'upload_requested',
      mimeType: 'application/pdf',
      storageKey: `db/property-import-media/${mediaId}`,
    });

    mockTx.propertyImportMediaBlob.create.mockResolvedValue({ mediaId });
    mockTx.propertyImportMedia.update.mockResolvedValue({ id: mediaId, status: 'uploaded' });

    const response = await request(app)
      .put(`/${uploadToken}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('pdf'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
