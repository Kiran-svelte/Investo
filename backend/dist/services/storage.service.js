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
exports.isAwsStorageConfigured = isAwsStorageConfigured;
exports.isR2StorageConfigured = isR2StorageConfigured;
exports.ensureR2Config = ensureR2Config;
exports.ensureAwsConfig = ensureAwsConfig;
const crypto_1 = require("crypto");
const path_1 = __importDefault(require("path"));
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const config_1 = __importDefault(require("../config"));
const supabaseStorage_service_1 = require("./supabaseStorage.service");
const storageTargets_1 = require("./storageTargets");
class StorageObjectVerificationError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseDbPropertyImportMediaId(key) {
    if (!(0, storageTargets_1.isDbPropertyImportMediaKey)(key)) {
        throw new StorageObjectVerificationError('Invalid storage key', 400);
    }
    const mediaId = key.slice(storageTargets_1.DB_PROPERTY_IMPORT_MEDIA_PREFIX.length).trim();
    if (!UUID_RE.test(mediaId)) {
        throw new StorageObjectVerificationError('Invalid storage key', 400);
    }
    return mediaId;
}
function ensureAwsConfig() {
    const required = [
        ['AWS_ACCESS_KEY_ID', config_1.default.storage.awsAccessKeyId],
        ['AWS_SECRET_ACCESS_KEY', config_1.default.storage.awsSecretAccessKey],
        ['AWS_S3_BUCKET', config_1.default.storage.awsBucket],
        ['AWS_REGION', config_1.default.storage.awsRegion],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        throw new Error(`AWS S3 storage is not configured. Missing environment variables: ${missing.join(', ')}`);
    }
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
function buildRelativeObjectKey(input) {
    const extension = getMimeTypeExtension(input.mimeType);
    const cleanFileName = sanitizeFileName(input.fileName);
    const assetType = input.assetType || (input.mimeType === 'application/pdf' ? 'brochure' : 'image');
    if (input.uploadScope === 'ai-greeting') {
        return [
            'companies',
            input.companyId,
            'ai-greeting',
            assetType,
            `${Date.now()}-${(0, crypto_1.randomUUID)()}-${cleanFileName}${extension}`,
        ].join('/');
    }
    const propertySegment = input.propertyId || 'draft';
    return [
        'companies',
        input.companyId,
        'properties',
        propertySegment,
        assetType,
        `${Date.now()}-${(0, crypto_1.randomUUID)()}-${cleanFileName}${extension}`,
    ].join('/');
}
function isAwsStorageConfigured() {
    return Boolean(config_1.default.storage.awsAccessKeyId
        && config_1.default.storage.awsSecretAccessKey
        && config_1.default.storage.awsBucket
        && config_1.default.storage.awsRegion);
}
function isR2StorageConfigured() {
    try {
        ensureR2Config();
        return true;
    }
    catch {
        return false;
    }
}
class StorageService {
    constructor() {
        this.awsClient = null;
        this.r2Client = null;
    }
    getAwsClient() {
        if (!this.awsClient) {
            ensureAwsConfig();
            this.awsClient = new client_s3_1.S3Client({
                region: config_1.default.storage.awsRegion,
                credentials: {
                    accessKeyId: config_1.default.storage.awsAccessKeyId,
                    secretAccessKey: config_1.default.storage.awsSecretAccessKey,
                },
            });
        }
        return this.awsClient;
    }
    getR2Client() {
        if (!this.r2Client) {
            const hasExplicitEndpoint = Boolean(config_1.default.storage.r2Endpoint);
            this.r2Client = new client_s3_1.S3Client({
                region: config_1.default.storage.r2Region || 'auto',
                endpoint: buildR2Endpoint(),
                forcePathStyle: hasExplicitEndpoint,
                credentials: {
                    accessKeyId: config_1.default.storage.r2AccessKeyId,
                    secretAccessKey: config_1.default.storage.r2SecretAccessKey,
                },
            });
        }
        return this.r2Client;
    }
    validateAssetRequest(input) {
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
    getAwsPublicUrl(objectKey) {
        const trimmed = objectKey.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
        }
        const configured = (config_1.default.storage.awsPublicBaseUrl || '').trim();
        if (configured) {
            const base = normalizeBaseUrl(configured);
            const path = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
            return new URL(path, base).toString();
        }
        const region = config_1.default.storage.awsRegion;
        const bucket = config_1.default.storage.awsBucket;
        return `https://${bucket}.s3.${region}.amazonaws.com/${trimmed}`;
    }
    /**
     * Presigned GET for WhatsApp/Meta document fetch (works with private buckets).
     */
    async getPresignedDownloadUrl(reference, expiresInSeconds = 3600) {
        const objectKey = (0, storageTargets_1.extractAwsObjectKeyFromReference)(reference);
        if (!objectKey) {
            throw new Error('Could not resolve S3 object key for download');
        }
        ensureAwsConfig();
        const url = await (0, s3_request_presigner_1.getSignedUrl)(this.getAwsClient(), new client_s3_1.GetObjectCommand({
            Bucket: config_1.default.storage.awsBucket,
            Key: objectKey,
        }), { expiresIn: expiresInSeconds });
        return url;
    }
    getR2PublicUrl(key) {
        ensureR2Config();
        const configuredBaseUrl = (config_1.default.storage.r2PublicBaseUrl || '').trim();
        if (configuredBaseUrl) {
            return new URL(key, normalizeBaseUrl(configuredBaseUrl)).toString();
        }
        const endpoint = buildR2Endpoint();
        return new URL(`${config_1.default.storage.r2Bucket}/${key}`, normalizeBaseUrl(endpoint)).toString();
    }
    async createAwsPropertyUploadUrl(input) {
        this.validateAssetRequest(input);
        ensureAwsConfig();
        const relativeKey = buildRelativeObjectKey(input);
        const objectKey = `${config_1.default.storage.awsKeyPrefix}${relativeKey}`;
        const storageKey = `${storageTargets_1.AWS_STORAGE_PREFIX}${objectKey}`;
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(this.getAwsClient(), new client_s3_1.PutObjectCommand({
            Bucket: config_1.default.storage.awsBucket,
            Key: objectKey,
            ContentType: input.mimeType,
        }), { expiresIn: 15 * 60 });
        return {
            key: storageKey,
            uploadUrl,
            publicUrl: this.getAwsPublicUrl(objectKey),
            expiresInSeconds: 15 * 60,
            contentType: input.mimeType,
            provider: 'aws',
        };
    }
    async createR2PropertyUploadUrl(input) {
        this.validateAssetRequest(input);
        ensureR2Config();
        const key = buildRelativeObjectKey(input);
        const storageKey = `${storageTargets_1.R2_STORAGE_PREFIX}${key}`;
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(this.getR2Client(), new client_s3_1.PutObjectCommand({
            Bucket: config_1.default.storage.r2Bucket,
            Key: key,
            ContentType: input.mimeType,
        }), { expiresIn: 15 * 60 });
        return {
            key: storageKey,
            uploadUrl,
            publicUrl: this.getR2PublicUrl(key),
            expiresInSeconds: 15 * 60,
            contentType: input.mimeType,
            provider: 'r2',
        };
    }
    /** AWS S3 first, then Cloudflare R2. */
    async createPropertyUploadUrl(input) {
        if (isAwsStorageConfigured()) {
            try {
                return await this.createAwsPropertyUploadUrl(input);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (!isR2StorageConfigured()) {
                    throw err;
                }
                const { default: logger } = await Promise.resolve().then(() => __importStar(require('../config/logger')));
                logger.warn('AWS S3 presigned upload failed; trying R2', { error: message });
            }
        }
        if (isR2StorageConfigured()) {
            return this.createR2PropertyUploadUrl(input);
        }
        throw new Error('No object storage configured (AWS S3 or R2 required)');
    }
    async createAiGreetingMediaUploadUrl(input) {
        return this.createPropertyUploadUrl({ ...input, uploadScope: 'ai-greeting' });
    }
    getPublicUrl(key) {
        const awsKey = (0, storageTargets_1.parseAwsStorageKey)(key);
        if (awsKey) {
            return this.getAwsPublicUrl(awsKey);
        }
        const r2Key = (0, storageTargets_1.parseR2StorageKey)(key);
        if (r2Key) {
            return this.getR2PublicUrl(r2Key);
        }
        throw new Error('Invalid storage key');
    }
    async putObjectBytes(storageKey, bytes, contentType) {
        const awsKey = (0, storageTargets_1.parseAwsStorageKey)(storageKey);
        if (awsKey) {
            ensureAwsConfig();
            await this.getAwsClient().send(new client_s3_1.PutObjectCommand({
                Bucket: config_1.default.storage.awsBucket,
                Key: awsKey,
                Body: bytes,
                ContentType: contentType,
            }));
            return { publicUrl: this.getAwsPublicUrl(awsKey) };
        }
        const supabaseKey = (0, storageTargets_1.parseSupabaseStorageKey)(storageKey);
        if (supabaseKey) {
            const { uploadToSupabaseBucket } = await Promise.resolve().then(() => __importStar(require('./supabaseStorage.service')));
            return uploadToSupabaseBucket(supabaseKey.bucket, supabaseKey.objectPath, bytes, contentType);
        }
        const r2Key = (0, storageTargets_1.parseR2StorageKey)(storageKey);
        if (r2Key) {
            ensureR2Config();
            await this.getR2Client().send(new client_s3_1.PutObjectCommand({
                Bucket: config_1.default.storage.r2Bucket,
                Key: r2Key,
                Body: bytes,
                ContentType: contentType,
            }));
            return { publicUrl: this.getR2PublicUrl(r2Key) };
        }
        throw new Error('Direct putObjectBytes is not supported for this storage key');
    }
    async getObjectBuffer(key) {
        const supabaseKey = (0, storageTargets_1.parseSupabaseStorageKey)(key);
        if (supabaseKey) {
            if (!(0, supabaseStorage_service_1.isSupabaseStorageConfigured)()) {
                throw new Error('Supabase storage is not configured');
            }
            return (0, supabaseStorage_service_1.downloadFromSupabaseBucket)(supabaseKey.bucket, supabaseKey.objectPath);
        }
        if ((0, storageTargets_1.isDbPropertyImportMediaKey)(key)) {
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
        const awsKey = (0, storageTargets_1.parseAwsStorageKey)(key);
        if (awsKey) {
            ensureAwsConfig();
            const response = await this.getAwsClient().send(new client_s3_1.GetObjectCommand({
                Bucket: config_1.default.storage.awsBucket,
                Key: awsKey,
            }));
            if (!response.Body) {
                throw new Error('Storage object body is empty');
            }
            return readBodyToBuffer(response.Body);
        }
        const r2Key = (0, storageTargets_1.parseR2StorageKey)(key);
        if (!r2Key) {
            throw new Error('Invalid storage key');
        }
        ensureR2Config();
        const response = await this.getR2Client().send(new client_s3_1.GetObjectCommand({
            Bucket: config_1.default.storage.r2Bucket,
            Key: r2Key,
        }));
        if (!response.Body) {
            throw new Error('Storage object body is empty');
        }
        return readBodyToBuffer(response.Body);
    }
    async verifyUploadedObject(key, expected) {
        const supabaseKey = (0, storageTargets_1.parseSupabaseStorageKey)(key);
        if (supabaseKey) {
            if (!(0, supabaseStorage_service_1.isSupabaseStorageConfigured)()) {
                return { exists: false };
            }
            try {
                const buffer = await (0, supabaseStorage_service_1.downloadFromSupabaseBucket)(supabaseKey.bucket, supabaseKey.objectPath);
                const contentLength = buffer.length;
                if (typeof expected.fileSize === 'number' && expected.fileSize !== contentLength) {
                    throw new StorageObjectVerificationError(`Uploaded object size mismatch. Expected ${expected.fileSize} bytes, got ${contentLength} bytes`, 409);
                }
                return {
                    exists: true,
                    contentType: expected.mimeType,
                    contentLength,
                };
            }
            catch (err) {
                if (err instanceof StorageObjectVerificationError) {
                    throw err;
                }
                return { exists: false };
            }
        }
        if ((0, storageTargets_1.isDbPropertyImportMediaKey)(key)) {
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
        const awsKey = (0, storageTargets_1.parseAwsStorageKey)(key);
        if (awsKey) {
            return this.verifyS3Object(this.getAwsClient(), config_1.default.storage.awsBucket, awsKey, expected);
        }
        const r2Key = (0, storageTargets_1.parseR2StorageKey)(key);
        if (r2Key) {
            ensureR2Config();
            return this.verifyS3Object(this.getR2Client(), config_1.default.storage.r2Bucket, r2Key, expected);
        }
        return { exists: false };
    }
    async verifyS3Object(client, bucket, objectKey, expected) {
        try {
            const metadata = await client.send(new client_s3_1.HeadObjectCommand({
                Bucket: bucket,
                Key: objectKey,
            }));
            const contentType = metadata.ContentType || undefined;
            const contentLength = typeof metadata.ContentLength === 'number' ? metadata.ContentLength : undefined;
            const eTag = metadata.ETag ? metadata.ETag.replace(/\"/g, '') : undefined;
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
                eTag,
            };
        }
        catch (error) {
            if (error instanceof StorageObjectVerificationError) {
                throw error;
            }
            if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
                return { exists: false };
            }
            throw error;
        }
    }
    /** Store a project attachment (CSV, Excel, PDF) under the tenant prefix. */
    async uploadProjectFileBuffer(input) {
        ensureAwsConfig();
        const safeName = sanitizeFileName(input.fileName);
        const storageKey = `companies/${input.companyId}/property-projects/${input.projectId}/files/${(0, crypto_1.randomUUID)()}-${safeName}${getMimeTypeExtension(input.mimeType)}`;
        const client = this.getAwsClient();
        await client.send(new client_s3_1.PutObjectCommand({
            Bucket: config_1.default.storage.awsBucket,
            Key: storageKey,
            Body: input.buffer,
            ContentType: input.mimeType,
        }));
        return { storageKey };
    }
}
exports.storageService = new StorageService();
