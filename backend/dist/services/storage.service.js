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
exports.storageService = void 0;
exports.ensureR2Config = ensureR2Config;
const crypto_1 = require("crypto");
const path_1 = __importDefault(require("path"));
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const config_1 = __importDefault(require("../config"));
class StorageObjectVerificationError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}
const DB_PROPERTY_IMPORT_MEDIA_PREFIX = 'db/property-import-media/';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isDbPropertyImportMediaKey(key) {
    return typeof key === 'string' && key.startsWith(DB_PROPERTY_IMPORT_MEDIA_PREFIX);
}
function parseDbPropertyImportMediaId(key) {
    if (!isDbPropertyImportMediaKey(key)) {
        throw new StorageObjectVerificationError('Invalid storage key', 400);
    }
    const mediaId = key.slice(DB_PROPERTY_IMPORT_MEDIA_PREFIX.length).trim();
    if (!UUID_RE.test(mediaId)) {
        throw new StorageObjectVerificationError('Invalid storage key', 400);
    }
    return mediaId;
}
function ensureR2Config(options = {}) {
    const hasExplicitEndpoint = Boolean(config_1.default.storage.r2Endpoint);
    const required = [
        ...(hasExplicitEndpoint ? [] : [['R2_ACCOUNT_ID', config_1.default.storage.r2AccountId]]),
        ['R2_ACCESS_KEY_ID', config_1.default.storage.r2AccessKeyId],
        ['R2_SECRET_ACCESS_KEY', config_1.default.storage.r2SecretAccessKey],
        ['R2_BUCKET', config_1.default.storage.r2Bucket],
    ];
    if (options.requirePublicBaseUrl) {
        required.push(['R2_PUBLIC_BASE_URL', config_1.default.storage.r2PublicBaseUrl]);
    }
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        throw new Error(`R2 storage is not configured. Missing environment variables: ${missing.join(', ')}`);
    }
}
function buildR2Endpoint() {
    ensureR2Config();
    const explicitEndpoint = config_1.default.storage.r2Endpoint?.trim();
    if (explicitEndpoint) {
        return explicitEndpoint.replace(/\/+$/, '');
    }
    return `https://${config_1.default.storage.r2AccountId}.r2.cloudflarestorage.com`;
}
function getMimeTypeExtension(mimeType) {
    switch (mimeType) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/png':
            return '.png';
        case 'image/webp':
            return '.webp';
        case 'application/pdf':
            return '.pdf';
        case 'video/mp4':
            return '.mp4';
        default:
            return '';
    }
}
function sanitizeFileName(fileName) {
    const baseName = path_1.default.basename(fileName, path_1.default.extname(fileName));
    return baseName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'asset';
}
function normalizeBaseUrl(baseUrl) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}
function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
        return `${bytes}`;
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const kilobytes = bytes / 1024;
    if (kilobytes < 1024) {
        return `${kilobytes.toFixed(1)} KB`;
    }
    const megabytes = kilobytes / 1024;
    if (megabytes < 1024) {
        return `${megabytes.toFixed(1)} MB`;
    }
    const gigabytes = megabytes / 1024;
    return `${gigabytes.toFixed(2)} GB`;
}
async function readBodyToBuffer(body) {
    if (!body) {
        return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(body)) {
        return body;
    }
    if (body instanceof Uint8Array) {
        return Buffer.from(body);
    }
    if (typeof body === 'string') {
        return Buffer.from(body);
    }
    if (typeof body.arrayBuffer === 'function') {
        const ab = await body.arrayBuffer();
        return Buffer.from(ab);
    }
    if (typeof body.transformToByteArray === 'function') {
        const bytes = await body.transformToByteArray();
        return Buffer.from(bytes);
    }
    if (typeof body.on === 'function') {
        return await new Promise((resolve, reject) => {
            const chunks = [];
            body.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            body.once('end', () => resolve(Buffer.concat(chunks)));
            body.once('error', reject);
        });
    }
    throw new Error('Unsupported object body type');
}
class StorageService {
    constructor() {
        this.client = null;
    }
    getClient() {
        if (!this.client) {
            const hasExplicitEndpoint = Boolean(config_1.default.storage.r2Endpoint);
            this.client = new client_s3_1.S3Client({
                region: config_1.default.storage.r2Region || 'auto',
                endpoint: buildR2Endpoint(),
                // Many S3-compatible providers (e.g., MinIO behind a custom domain) work best with path-style.
                forcePathStyle: hasExplicitEndpoint,
                credentials: {
                    accessKeyId: config_1.default.storage.r2AccessKeyId,
                    secretAccessKey: config_1.default.storage.r2SecretAccessKey,
                },
            });
        }
        return this.client;
    }
    validateAssetRequest(input) {
        ensureR2Config();
        if (!config_1.default.storage.allowedMimeTypes.includes(input.mimeType)) {
            throw new Error(`Unsupported mime type: ${input.mimeType}`);
        }
        if (input.fileSize <= 0) {
            throw new Error('File size must be greater than zero');
        }
        if (input.fileSize > config_1.default.storage.propertyUploadMaxBytes) {
            throw new Error(`File size exceeds the maximum allowed size of ${formatBytes(config_1.default.storage.propertyUploadMaxBytes)} (${config_1.default.storage.propertyUploadMaxBytes} bytes)`);
        }
    }
    async createPropertyUploadUrl(input) {
        this.validateAssetRequest(input);
        const extension = getMimeTypeExtension(input.mimeType);
        const cleanFileName = sanitizeFileName(input.fileName);
        const assetType = input.assetType || (input.mimeType === 'application/pdf' ? 'brochure' : 'image');
        const propertySegment = input.propertyId || 'draft';
        const key = [
            'companies',
            input.companyId,
            'properties',
            propertySegment,
            assetType,
            `${Date.now()}-${(0, crypto_1.randomUUID)()}-${cleanFileName}${extension}`,
        ].join('/');
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(this.getClient(), new client_s3_1.PutObjectCommand({
            Bucket: config_1.default.storage.r2Bucket,
            Key: key,
            ContentType: input.mimeType,
        }), { expiresIn: 15 * 60 });
        return {
            key,
            uploadUrl,
            publicUrl: this.getPublicUrl(key),
            expiresInSeconds: 15 * 60,
            contentType: input.mimeType,
        };
    }
    getPublicUrl(key) {
        ensureR2Config();
        const configuredBaseUrl = (config_1.default.storage.r2PublicBaseUrl || '').trim();
        if (configuredBaseUrl) {
            return new URL(key, normalizeBaseUrl(configuredBaseUrl)).toString();
        }
        // Fallback: path-style URL against the R2 S3 endpoint.
        // Note: this may not be publicly accessible unless the bucket is configured for public reads.
        const endpoint = buildR2Endpoint();
        return new URL(`${config_1.default.storage.r2Bucket}/${key}`, normalizeBaseUrl(endpoint)).toString();
    }
    async getObjectBuffer(key) {
        if (isDbPropertyImportMediaKey(key)) {
            const mediaId = parseDbPropertyImportMediaId(key);
            const prisma = (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default;
            const blob = await prisma.propertyImportMediaBlob.findUnique({
                where: { mediaId },
                select: { bytes: true },
            });
            if (!blob?.bytes) {
                throw new Error('Uploaded object was not found in storage');
            }
            return Buffer.isBuffer(blob.bytes) ? blob.bytes : Buffer.from(blob.bytes);
        }
        ensureR2Config();
        const response = await this.getClient().send(new client_s3_1.GetObjectCommand({
            Bucket: config_1.default.storage.r2Bucket,
            Key: key,
        }));
        if (!response.Body) {
            throw new Error('Storage object body is empty');
        }
        return readBodyToBuffer(response.Body);
    }
    async verifyUploadedObject(key, expected) {
        if (isDbPropertyImportMediaKey(key)) {
            const mediaId = parseDbPropertyImportMediaId(key);
            const prisma = (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default;
            const blob = await prisma.propertyImportMediaBlob.findUnique({
                where: { mediaId },
                select: {
                    mimeType: true,
                    fileSize: true,
                },
            });
            if (!blob) {
                return { exists: false };
            }
            const contentType = blob.mimeType || undefined;
            const contentLength = typeof blob.fileSize === 'number' ? blob.fileSize : undefined;
            if (expected.mimeType && contentType && expected.mimeType !== contentType) {
                throw new StorageObjectVerificationError(`Uploaded object mime type mismatch. Expected ${expected.mimeType}, got ${contentType}`, 409);
            }
            if (typeof expected.fileSize === 'number' && typeof contentLength === 'number' && expected.fileSize !== contentLength) {
                throw new StorageObjectVerificationError(`Uploaded object size mismatch. Expected ${expected.fileSize} bytes, got ${contentLength} bytes`, 409);
            }
            return {
                exists: true,
                contentType,
                contentLength,
                eTag: undefined,
            };
        }
        ensureR2Config();
        try {
            const metadata = await this.getClient().send(new client_s3_1.HeadObjectCommand({
                Bucket: config_1.default.storage.r2Bucket,
                Key: key,
            }));
            const contentType = metadata.ContentType || undefined;
            const contentLength = typeof metadata.ContentLength === 'number' ? metadata.ContentLength : undefined;
            const eTag = metadata.ETag ? metadata.ETag.replace(/\"/g, '') : undefined;
            if (expected.mimeType && contentType && expected.mimeType !== contentType) {
                throw new Error(`Uploaded object mime type mismatch. Expected ${expected.mimeType}, got ${contentType}`);
            }
            if (typeof expected.fileSize === 'number' && typeof contentLength === 'number' && expected.fileSize !== contentLength) {
                throw new Error(`Uploaded object size mismatch. Expected ${expected.fileSize} bytes, got ${contentLength} bytes`);
            }
            return {
                exists: true,
                contentType,
                contentLength,
                eTag,
            };
        }
        catch (error) {
            if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
                return { exists: false };
            }
            throw error;
        }
    }
}
exports.storageService = new StorageService();
//# sourceMappingURL=storage.service.js.map