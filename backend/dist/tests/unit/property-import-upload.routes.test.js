"use strict";
/// <reference types="jest" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
jest.setTimeout(30000);
function createUploadApp(options) {
    jest.resetModules();
    const mockTx = {
        propertyImportMedia: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        propertyImportMediaBlob: {
            create: jest.fn(),
        },
    };
    const mockPrisma = {
        $transaction: jest.fn(async (fn) => fn(mockTx)),
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
    let uploadRoutes;
    jest.isolateModules(() => {
        uploadRoutes = require('../../routes/property-import-upload.routes').default;
    });
    const app = (0, express_1.default)();
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
        const response = await (0, supertest_1.default)(app)
            .put(`/${uploadToken}`)
            .set('Content-Type', 'application/pdf')
            .send(Buffer.from('pdf'));
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });
        expect(mockTx.propertyImportMediaBlob.create).toHaveBeenCalledTimes(1);
        const blobArg = mockTx.propertyImportMediaBlob.create.mock.calls[0][0];
        expect(blobArg.data).toEqual(expect.objectContaining({
            mediaId,
            companyId,
            mimeType: 'application/pdf',
            fileSize: 3,
        }));
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
        const response = await (0, supertest_1.default)(app)
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
        const response = await (0, supertest_1.default)(app)
            .put(`/${uploadToken}`)
            .set('Content-Type', 'application/pdf')
            .send(Buffer.from('pdf'));
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true });
        expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=property-import-upload.routes.test.js.map