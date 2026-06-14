import { randomUUID } from 'crypto';
import path from 'path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../config';
import { downloadFromSupabaseBucket, isSupabaseStorageConfigured } from './supabaseStorage.service';
import {
  AWS_STORAGE_PREFIX,
  DB_PROPERTY_IMPORT_MEDIA_PREFIX,
  R2_STORAGE_PREFIX,
  isDbPropertyImportMediaKey,
  extractAwsObjectKeyFromReference,
  parseAwsStorageKey,
  parseR2StorageKey,
  parseSupabaseStorageKey,
} from './storageTargets';

export interface PropertyUploadUrlInput {
  companyId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  propertyId?: string | null;
  assetType?: 'image' | 'brochure';
  /** Default `property` — use `ai-greeting` for AI settings welcome attachments. */
  uploadScope?: 'property' | 'ai-greeting';
}

export interface PropertyUploadUrlResult {
  key: string;
  uploadUrl: string;
  publicUrl: string;
  expiresInSeconds: number;
  contentType: string;
  provider: 'aws' | 'r2';
}

export interface UploadedObjectVerification {
  exists: boolean;
  contentType?: string;
  contentLength?: number;
  eTag?: string;
}

class StorageObjectVerificationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDbPropertyImportMediaId(key: string): string {
  if (!isDbPropertyImportMediaKey(key)) {
    throw new StorageObjectVerificationError('Invalid storage key', 400);
  }

  const mediaId = key.slice(DB_PROPERTY_IMPORT_MEDIA_PREFIX.length).trim();
  if (!UUID_RE.test(mediaId)) {
    throw new StorageObjectVerificationError('Invalid storage key', 400);
  }

  return mediaId;
}

function ensureAwsConfig(): void {
  const required: Array<[string, string]> = [
    ['AWS_ACCESS_KEY_ID', config.storage.awsAccessKeyId],
    ['AWS_SECRET_ACCESS_KEY', config.storage.awsSecretAccessKey],
    ['AWS_S3_BUCKET', config.storage.awsBucket],
    ['AWS_REGION', config.storage.awsRegion],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`AWS S3 storage is not configured. Missing environment variables: ${missing.join(', ')}`);
  }
}

function ensureR2Config(options: { requirePublicBaseUrl?: boolean } = {}): void {
  const hasExplicitEndpoint = Boolean(config.storage.r2Endpoint);

  const required: Array<[string, string]> = [
    ...(hasExplicitEndpoint ? [] : [['R2_ACCOUNT_ID', config.storage.r2AccountId] as [string, string]]),
    ['R2_ACCESS_KEY_ID', config.storage.r2AccessKeyId],
    ['R2_SECRET_ACCESS_KEY', config.storage.r2SecretAccessKey],
    ['R2_BUCKET', config.storage.r2Bucket],
  ];

  if (options.requirePublicBaseUrl) {
    required.push(['R2_PUBLIC_BASE_URL', config.storage.r2PublicBaseUrl]);
  }

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`R2 storage is not configured. Missing environment variables: ${missing.join(', ')}`);
  }
}

function buildR2Endpoint(): string {
  ensureR2Config();
  const explicitEndpoint = config.storage.r2Endpoint?.trim();
  if (explicitEndpoint) {
    return explicitEndpoint.replace(/\/+$/, '');
  }
  return `https://${config.storage.r2AccountId}.r2.cloudflarestorage.com`;
}

function getMimeTypeExtension(mimeType: string): string {
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

function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName, path.extname(fileName));
  return baseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset';
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function formatBytes(bytes: number): string {
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

async function readBodyToBuffer(body: any): Promise<Buffer> {
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
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      body.on('data', (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      body.once('end', () => resolve(Buffer.concat(chunks)));
      body.once('error', reject);
    });
  }

  throw new Error('Unsupported object body type');
}

function buildRelativeObjectKey(input: PropertyUploadUrlInput): string {
  const extension = getMimeTypeExtension(input.mimeType);
  const cleanFileName = sanitizeFileName(input.fileName);
  const assetType = input.assetType || (input.mimeType === 'application/pdf' ? 'brochure' : 'image');

  if (input.uploadScope === 'ai-greeting') {
    return [
      'companies',
      input.companyId,
      'ai-greeting',
      assetType,
      `${Date.now()}-${randomUUID()}-${cleanFileName}${extension}`,
    ].join('/');
  }

  const propertySegment = input.propertyId || 'draft';

  return [
    'companies',
    input.companyId,
    'properties',
    propertySegment,
    assetType,
    `${Date.now()}-${randomUUID()}-${cleanFileName}${extension}`,
  ].join('/');
}

export function isAwsStorageConfigured(): boolean {
  return Boolean(
    config.storage.awsAccessKeyId
    && config.storage.awsSecretAccessKey
    && config.storage.awsBucket
    && config.storage.awsRegion,
  );
}

export function isR2StorageConfigured(): boolean {
  try {
    ensureR2Config();
    return true;
  } catch {
    return false;
  }
}

/** True when Meta cannot fetch the URL without a presigned GET (private object storage). */
export function storageUrlRequiresPresignedAccess(url: string): boolean {
  return /amazonaws\.com|\.s3\.|cloudflarestorage\.com|X-Amz-|AWSAccessKeyId=/i.test(url);
}

export class StorageService {
  private awsClient: S3Client | null = null;
  private r2Client: S3Client | null = null;

  private getAwsClient(): S3Client {
    if (!this.awsClient) {
      ensureAwsConfig();
      this.awsClient = new S3Client({
        region: config.storage.awsRegion,
        credentials: {
          accessKeyId: config.storage.awsAccessKeyId,
          secretAccessKey: config.storage.awsSecretAccessKey,
        },
      });
    }

    return this.awsClient;
  }

  private getR2Client(): S3Client {
    if (!this.r2Client) {
      const hasExplicitEndpoint = Boolean(config.storage.r2Endpoint);
      this.r2Client = new S3Client({
        region: config.storage.r2Region || 'auto',
        endpoint: buildR2Endpoint(),
        forcePathStyle: hasExplicitEndpoint,
        credentials: {
          accessKeyId: config.storage.r2AccessKeyId,
          secretAccessKey: config.storage.r2SecretAccessKey,
        },
      });
    }

    return this.r2Client;
  }

  private validateAssetRequest(input: PropertyUploadUrlInput): void {
    if (!config.storage.allowedMimeTypes.includes(input.mimeType)) {
      throw new Error(`Unsupported mime type: ${input.mimeType}`);
    }

    if (input.fileSize <= 0) {
      throw new Error('File size must be greater than zero');
    }

    if (input.fileSize > config.storage.propertyUploadMaxBytes) {
      throw new Error(
        `File size exceeds the maximum allowed size of ${formatBytes(config.storage.propertyUploadMaxBytes)} (${config.storage.propertyUploadMaxBytes} bytes)`,
      );
    }
  }

  private getAwsPublicUrl(objectKey: string): string {
    const trimmed = objectKey.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    const configured = (config.storage.awsPublicBaseUrl || '').trim();
    if (configured) {
      const base = normalizeBaseUrl(configured);
      const path = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
      return new URL(path, base).toString();
    }

    const region = config.storage.awsRegion;
    const bucket = config.storage.awsBucket;
    return `https://${bucket}.s3.${region}.amazonaws.com/${trimmed}`;
  }

  /**
   * Presigned GET for WhatsApp/Meta media fetch (works with private AWS S3 / R2 buckets).
   */
  async getPresignedDownloadUrl(reference: string, expiresInSeconds = 3600): Promise<string> {
    const trimmed = reference.trim();
    if (!trimmed) {
      throw new Error('Empty storage reference');
    }

    const awsKey = extractAwsObjectKeyFromReference(trimmed);
    if (awsKey && isAwsStorageConfigured()) {
      ensureAwsConfig();
      return getSignedUrl(
        this.getAwsClient(),
        new GetObjectCommand({
          Bucket: config.storage.awsBucket!,
          Key: awsKey,
        }),
        { expiresIn: expiresInSeconds },
      );
    }

    const r2Key = parseR2StorageKey(trimmed);
    if (r2Key && isR2StorageConfigured()) {
      ensureR2Config();
      return getSignedUrl(
        this.getR2Client(),
        new GetObjectCommand({
          Bucket: config.storage.r2Bucket!,
          Key: r2Key,
        }),
        { expiresIn: expiresInSeconds },
      );
    }

    if (trimmed.startsWith('https://') && !storageUrlRequiresPresignedAccess(trimmed)) {
      return trimmed;
    }

    throw new Error('Could not resolve object storage key for download');
  }

  private getR2PublicUrl(key: string): string {
    ensureR2Config();

    const configuredBaseUrl = (config.storage.r2PublicBaseUrl || '').trim();
    if (configuredBaseUrl) {
      return new URL(key, normalizeBaseUrl(configuredBaseUrl)).toString();
    }

    const endpoint = buildR2Endpoint();
    return new URL(`${config.storage.r2Bucket}/${key}`, normalizeBaseUrl(endpoint)).toString();
  }

  async createAwsPropertyUploadUrl(input: PropertyUploadUrlInput): Promise<PropertyUploadUrlResult> {
    this.validateAssetRequest(input);
    ensureAwsConfig();

    const relativeKey = buildRelativeObjectKey(input);
    const objectKey = `${config.storage.awsKeyPrefix}${relativeKey}`;
    const storageKey = `${AWS_STORAGE_PREFIX}${objectKey}`;

    const uploadUrl = await getSignedUrl(
      this.getAwsClient(),
      new PutObjectCommand({
        Bucket: config.storage.awsBucket,
        Key: objectKey,
        ContentType: input.mimeType,
      }),
      { expiresIn: 15 * 60 },
    );

    return {
      key: storageKey,
      uploadUrl,
      publicUrl: this.getAwsPublicUrl(objectKey),
      expiresInSeconds: 15 * 60,
      contentType: input.mimeType,
      provider: 'aws',
    };
  }

  async createR2PropertyUploadUrl(input: PropertyUploadUrlInput): Promise<PropertyUploadUrlResult> {
    this.validateAssetRequest(input);
    ensureR2Config();

    const key = buildRelativeObjectKey(input);
    const storageKey = `${R2_STORAGE_PREFIX}${key}`;

    const uploadUrl = await getSignedUrl(
      this.getR2Client(),
      new PutObjectCommand({
        Bucket: config.storage.r2Bucket,
        Key: key,
        ContentType: input.mimeType,
      }),
      { expiresIn: 15 * 60 },
    );

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
  async createPropertyUploadUrl(input: PropertyUploadUrlInput): Promise<PropertyUploadUrlResult> {
    if (isAwsStorageConfigured()) {
      try {
        return await this.createAwsPropertyUploadUrl(input);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isR2StorageConfigured()) {
          throw err;
        }
        const { default: logger } = await import('../config/logger');
        logger.warn('AWS S3 presigned upload failed; trying R2', { error: message });
      }
    }

    if (isR2StorageConfigured()) {
      return this.createR2PropertyUploadUrl(input);
    }

    throw new Error('No object storage configured (AWS S3 or R2 required)');
  }

  async createAiGreetingMediaUploadUrl(
    input: Omit<PropertyUploadUrlInput, 'propertyId' | 'uploadScope'>,
  ): Promise<PropertyUploadUrlResult> {
    return this.createPropertyUploadUrl({ ...input, uploadScope: 'ai-greeting' });
  }

  getPublicUrl(key: string): string {
    const awsKey = parseAwsStorageKey(key);
    if (awsKey) {
      return this.getAwsPublicUrl(awsKey);
    }

    const r2Key = parseR2StorageKey(key);
    if (r2Key) {
      return this.getR2PublicUrl(r2Key);
    }

    throw new Error('Invalid storage key');
  }

  async putObjectBytes(storageKey: string, bytes: Buffer, contentType: string): Promise<{ publicUrl: string }> {
    const awsKey = parseAwsStorageKey(storageKey);
    if (awsKey) {
      ensureAwsConfig();
      await this.getAwsClient().send(
        new PutObjectCommand({
          Bucket: config.storage.awsBucket,
          Key: awsKey,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      return { publicUrl: this.getAwsPublicUrl(awsKey) };
    }

    const supabaseKey = parseSupabaseStorageKey(storageKey);
    if (supabaseKey) {
      const { uploadToSupabaseBucket } = await import('./supabaseStorage.service');
      return uploadToSupabaseBucket(supabaseKey.bucket, supabaseKey.objectPath, bytes, contentType);
    }

    const r2Key = parseR2StorageKey(storageKey);
    if (r2Key) {
      ensureR2Config();
      await this.getR2Client().send(
        new PutObjectCommand({
          Bucket: config.storage.r2Bucket,
          Key: r2Key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      return { publicUrl: this.getR2PublicUrl(r2Key) };
    }

    throw new Error('Direct putObjectBytes is not supported for this storage key');
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const supabaseKey = parseSupabaseStorageKey(key);
    if (supabaseKey) {
      if (!isSupabaseStorageConfigured()) {
        throw new Error('Supabase storage is not configured');
      }
      return downloadFromSupabaseBucket(supabaseKey.bucket, supabaseKey.objectPath);
    }

    if (isDbPropertyImportMediaKey(key)) {
      const mediaId = parseDbPropertyImportMediaId(key);
      const prisma = (await import('../config/prisma')).default;
      const blob = await prisma.propertyImportMediaBlob.findUnique({
        where: { mediaId },
        select: { bytes: true },
      });

      if (!blob?.bytes) {
        throw new Error('Uploaded object was not found in storage');
      }

      return Buffer.isBuffer(blob.bytes) ? blob.bytes : Buffer.from(blob.bytes);
    }

    const awsKey = parseAwsStorageKey(key);
    if (awsKey) {
      ensureAwsConfig();
      const response = await this.getAwsClient().send(
        new GetObjectCommand({
          Bucket: config.storage.awsBucket,
          Key: awsKey,
        }),
      );
      if (!response.Body) {
        throw new Error('Storage object body is empty');
      }
      return readBodyToBuffer(response.Body);
    }

    const r2Key = parseR2StorageKey(key);
    if (!r2Key) {
      throw new Error('Invalid storage key');
    }

    ensureR2Config();
    const response = await this.getR2Client().send(
      new GetObjectCommand({
        Bucket: config.storage.r2Bucket,
        Key: r2Key,
      }),
    );

    if (!response.Body) {
      throw new Error('Storage object body is empty');
    }

    return readBodyToBuffer(response.Body);
  }

  async verifyUploadedObject(
    key: string,
    expected: { mimeType?: string; fileSize?: number },
  ): Promise<UploadedObjectVerification> {
    const supabaseKey = parseSupabaseStorageKey(key);
    if (supabaseKey) {
      if (!isSupabaseStorageConfigured()) {
        return { exists: false };
      }

      try {
        const buffer = await downloadFromSupabaseBucket(supabaseKey.bucket, supabaseKey.objectPath);
        const contentLength = buffer.length;

        if (typeof expected.fileSize === 'number' && expected.fileSize !== contentLength) {
          throw new StorageObjectVerificationError(
            `Uploaded object size mismatch. Expected ${expected.fileSize} bytes, got ${contentLength} bytes`,
            409,
          );
        }

        return {
          exists: true,
          contentType: expected.mimeType,
          contentLength,
        };
      } catch (err: any) {
        if (err instanceof StorageObjectVerificationError) {
          throw err;
        }
        return { exists: false };
      }
    }

    if (isDbPropertyImportMediaKey(key)) {
      const mediaId = parseDbPropertyImportMediaId(key);
      const prisma = (await import('../config/prisma')).default;
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
        throw new StorageObjectVerificationError(
          `Uploaded object mime type mismatch. Expected ${expected.mimeType}, got ${contentType}`,
          409,
        );
      }

      if (typeof expected.fileSize === 'number' && typeof contentLength === 'number' && expected.fileSize !== contentLength) {
        throw new StorageObjectVerificationError(
          `Uploaded object size mismatch. Expected ${expected.fileSize} bytes, got ${contentLength} bytes`,
          409,
        );
      }

      return {
        exists: true,
        contentType,
        contentLength,
        eTag: undefined,
      };
    }

    const awsKey = parseAwsStorageKey(key);
    if (awsKey) {
      return this.verifyS3Object(this.getAwsClient(), config.storage.awsBucket, awsKey, expected);
    }

    const r2Key = parseR2StorageKey(key);
    if (r2Key) {
      ensureR2Config();
      return this.verifyS3Object(this.getR2Client(), config.storage.r2Bucket, r2Key, expected);
    }

    return { exists: false };
  }

  private async verifyS3Object(
    client: S3Client,
    bucket: string,
    objectKey: string,
    expected: { mimeType?: string; fileSize?: number },
  ): Promise<UploadedObjectVerification> {
    try {
      const metadata = await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: objectKey,
        }),
      );

      const contentType = metadata.ContentType || undefined;
      const contentLength = typeof metadata.ContentLength === 'number' ? metadata.ContentLength : undefined;
      const eTag = metadata.ETag ? metadata.ETag.replace(/\"/g, '') : undefined;

      if (expected.mimeType && contentType && expected.mimeType !== contentType) {
        throw new StorageObjectVerificationError(
          `Uploaded object mime type mismatch. Expected ${expected.mimeType}, got ${contentType}`,
          409,
        );
      }

      if (typeof expected.fileSize === 'number' && typeof contentLength === 'number' && expected.fileSize !== contentLength) {
        throw new StorageObjectVerificationError(
          `Uploaded object size mismatch. Expected ${expected.fileSize} bytes, got ${contentLength} bytes`,
          409,
        );
      }

      return {
        exists: true,
        contentType,
        contentLength,
        eTag,
      };
    } catch (error: any) {
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
  async uploadProjectFileBuffer(input: {
    companyId: string;
    projectId: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ storageKey: string }> {
    ensureAwsConfig();
    const safeName = sanitizeFileName(input.fileName);
    const storageKey = `companies/${input.companyId}/property-projects/${input.projectId}/files/${randomUUID()}-${safeName}${getMimeTypeExtension(input.mimeType)}`;
    const client = this.getAwsClient();
    await client.send(
      new PutObjectCommand({
        Bucket: config.storage.awsBucket!,
        Key: storageKey,
        Body: input.buffer,
        ContentType: input.mimeType,
      }),
    );
    return { storageKey };
  }

  /** Direct server-side upload for property hero images / brochures (project board assign flow). */
  async uploadPropertyMediaBuffer(input: {
    companyId: string;
    propertyId: string;
    fileName: string;
    mimeType: string;
    assetType: 'image' | 'brochure';
    buffer: Buffer;
  }): Promise<{ publicUrl: string; storageKey: string }> {
    const uploadMeta = await this.createPropertyUploadUrl({
      companyId: input.companyId,
      propertyId: input.propertyId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.buffer.length,
      assetType: input.assetType,
    });
    const { publicUrl } = await this.putObjectBytes(uploadMeta.key, input.buffer, input.mimeType);
    return { publicUrl, storageKey: uploadMeta.key };
  }
}

export const storageService = new StorageService();
export { ensureR2Config, ensureAwsConfig };
