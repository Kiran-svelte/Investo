"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importStar(require("express"));
const logger_1 = __importDefault(require("../config/logger"));
const config_1 = __importDefault(require("../config"));
const prisma_1 = __importDefault(require("../config/prisma"));
const storage_service_1 = require("../services/storage.service");
const storageTargets_1 = require("../services/storageTargets");
const propertyImportUploadToken_util_1 = require("../utils/propertyImportUploadToken.util");
class PropertyImportUploadError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}
function normalizeContentType(value) {
    if (!value) {
        return '';
    }
    return value.split(';')[0].trim().toLowerCase();
}
function buildContentDisposition(fileName) {
    const raw = (fileName || 'upload').replace(/[\r\n]/g, ' ').trim() || 'upload';
    const fallback = raw
        .replace(/[\\"]/g, '_')
        .replace(/[^\x20-\x7E]+/g, '_')
        .slice(0, 180) || 'upload';
    const encoded = encodeURIComponent(raw);
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
function toDatabaseBytes(buffer) {
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    const out = new Uint8Array(arrayBuffer);
    out.set(buffer);
    return out;
}
const router = (0, express_1.Router)();
router.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    next();
});
function isMissingBlobTableError(err) {
    return (err?.code === 'P2021'
        && typeof err?.message === 'string'
        && err.message.toLowerCase().includes('property_import_media_blobs'));
}
async function ensurePropertyImportMediaBlobTable() {
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS property_import_media_blobs (
      media_id UUID PRIMARY KEY REFERENCES property_import_media(id) ON DELETE CASCADE,
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      mime_type VARCHAR(120) NOT NULL,
      file_size INTEGER NOT NULL,
      bytes BYTEA NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
}
async function assertSignedUploadAccess(uploadToken, companyId, createdAt, query) {
    const { expiresAtMs, signature } = (0, propertyImportUploadToken_util_1.parseSignedUploadQuery)(query);
    const fallbackExpiry = (0, propertyImportUploadToken_util_1.buildPropertyImportUploadExpiry)(createdAt);
    const effectiveExpiry = Number.isFinite(expiresAtMs) ? expiresAtMs : fallbackExpiry;
    if (!(0, propertyImportUploadToken_util_1.verifyPropertyImportUploadToken)(uploadToken, companyId, effectiveExpiry, signature)) {
        throw new PropertyImportUploadError('Upload signature invalid or expired', 403);
    }
}
async function persistUpload(uploadToken, contentType, bytes) {
    await prisma_1.default.$transaction(async (tx) => {
        const media = await tx.propertyImportMedia.findUnique({
            where: { uploadToken },
            select: {
                id: true,
                companyId: true,
                status: true,
                mimeType: true,
                storageKey: true,
            },
        });
        if (!media) {
            throw new PropertyImportUploadError('Upload token not found', 404);
        }
        if (media.status !== 'upload_requested') {
            throw new PropertyImportUploadError('Upload has already been completed', 409);
        }
        const isDbKey = media.storageKey.startsWith('db/property-import-media/');
        const isSupabaseKey = Boolean((0, storageTargets_1.parseSupabaseStorageKey)(media.storageKey));
        const isAwsKey = Boolean((0, storageTargets_1.parseAwsStorageKey)(media.storageKey));
        const isR2Key = Boolean((0, storageTargets_1.parseR2StorageKey)(media.storageKey));
        if (!isDbKey && !isSupabaseKey && !isAwsKey && !isR2Key) {
            throw new PropertyImportUploadError('Direct upload is not available for this token', 409);
        }
        const expectedContentType = normalizeContentType(media.mimeType);
        if (expectedContentType !== contentType) {
            throw new PropertyImportUploadError('Content-Type does not match registered mime type', 400);
        }
        if (isDbKey) {
            await tx.propertyImportMediaBlob.create({
                data: {
                    mediaId: media.id,
                    companyId: media.companyId,
                    mimeType: media.mimeType,
                    fileSize: bytes.length,
                    bytes: toDatabaseBytes(bytes),
                },
            });
        }
        else if (isAwsKey || isR2Key) {
            const uploaded = await storage_service_1.storageService.putObjectBytes(media.storageKey, bytes, media.mimeType);
            await tx.propertyImportMedia.update({
                where: { id: media.id },
                data: {
                    publicUrl: uploaded.publicUrl,
                },
            });
        }
        else {
            const supabaseKey = (0, storageTargets_1.parseSupabaseStorageKey)(media.storageKey);
            if (!supabaseKey) {
                throw new PropertyImportUploadError('Invalid Supabase storage key', 500);
            }
            const { uploadToSupabaseBucket } = await Promise.resolve().then(() => __importStar(require('../services/supabaseStorage.service')));
            const uploaded = await uploadToSupabaseBucket(supabaseKey.bucket, supabaseKey.objectPath, bytes, media.mimeType);
            await tx.propertyImportMedia.update({
                where: { id: media.id },
                data: {
                    publicUrl: uploaded.publicUrl,
                },
            });
        }
        await tx.propertyImportMedia.update({
            where: { id: media.id },
            data: {
                status: 'uploaded',
                uploadedAt: new Date(),
                failureReason: null,
            },
        });
    });
}
router.put('/:uploadToken', express_1.default.raw({
    type: '*/*',
    limit: config_1.default.storage.propertyUploadMaxBytes,
}), async (req, res) => {
    try {
        const uploadToken = String(req.params.uploadToken || '').trim();
        const contentType = normalizeContentType(req.header('content-type'));
        if (!uploadToken) {
            throw new PropertyImportUploadError('Upload token is required', 400);
        }
        if (!contentType) {
            throw new PropertyImportUploadError('Content-Type header is required', 400);
        }
        if (!Buffer.isBuffer(req.body)) {
            throw new PropertyImportUploadError('Invalid upload body', 400);
        }
        const bytes = req.body;
        if (bytes.length <= 0) {
            throw new PropertyImportUploadError('Upload body is empty', 400);
        }
        const media = await prisma_1.default.propertyImportMedia.findUnique({
            where: { uploadToken },
            select: { companyId: true, createdAt: true, status: true },
        });
        if (!media) {
            throw new PropertyImportUploadError('Upload token not found', 404);
        }
        await assertSignedUploadAccess(uploadToken, media.companyId, media.createdAt, req.query);
        try {
            await persistUpload(uploadToken, contentType, bytes);
        }
        catch (err) {
            if (!isMissingBlobTableError(err)) {
                throw err;
            }
            await ensurePropertyImportMediaBlobTable();
            await persistUpload(uploadToken, contentType, bytes);
        }
        res.status(200).json({ ok: true });
    }
    catch (err) {
        if (err instanceof PropertyImportUploadError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        if (err?.code === 'P2002') {
            res.status(409).json({ error: 'Upload has already been completed' });
            return;
        }
        logger_1.default.error('Property import upload failed', {
            uploadToken: String(req.params.uploadToken || ''),
            error: err?.message || String(err),
        });
        res.status(500).json({ error: err?.message || 'Failed to upload file' });
    }
});
router.get('/:uploadToken', async (req, res) => {
    try {
        const uploadToken = String(req.params.uploadToken || '').trim();
        if (!uploadToken) {
            throw new PropertyImportUploadError('Upload token is required', 400);
        }
        const media = await prisma_1.default.propertyImportMedia.findUnique({
            where: { uploadToken },
            select: {
                id: true,
                fileName: true,
                mimeType: true,
                storageKey: true,
                companyId: true,
                createdAt: true,
            },
        });
        if (!media) {
            throw new PropertyImportUploadError('Upload token not found', 404);
        }
        await assertSignedUploadAccess(uploadToken, media.companyId, media.createdAt, req.query);
        if (!media.storageKey.startsWith('db/property-import-media/')) {
            throw new PropertyImportUploadError('File not found', 404);
        }
        const blob = await prisma_1.default.propertyImportMediaBlob.findUnique({
            where: { mediaId: media.id },
            select: {
                bytes: true,
                mimeType: true,
                fileSize: true,
            },
        });
        if (!blob?.bytes) {
            throw new PropertyImportUploadError('File not found', 404);
        }
        const body = Buffer.isBuffer(blob.bytes) ? blob.bytes : Buffer.from(blob.bytes);
        res.setHeader('Content-Type', blob.mimeType || media.mimeType);
        res.setHeader('Content-Length', String(blob.fileSize || body.length));
        res.setHeader('Content-Disposition', buildContentDisposition(media.fileName));
        res.status(200).send(body);
    }
    catch (err) {
        if (err instanceof PropertyImportUploadError) {
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        res.status(500).json({ error: 'Failed to fetch file' });
    }
});
// Handle body-parser errors (e.g., file too large) within this router.
router.use((err, _req, res, next) => {
    if (err?.type === 'entity.too.large') {
        res.status(413).json({ error: 'File exceeds maximum allowed size' });
        return;
    }
    next(err);
});
exports.default = router;
