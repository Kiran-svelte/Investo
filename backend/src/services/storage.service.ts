import { randomUUID } from 'crypto';
import path from 'path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../config';

export interface PropertyUploadUrlInput {
  companyId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  propertyId?: string | null;
  assetType?: 'image' | 'brochure';
}

export interface PropertyUploadUrlResult {
  key: string;
  uploadUrl: string;
  publicUrl: string;
  expiresInSeconds: number;
  contentType: string;
}

export interface UploadedObjectVerification {
  exists: boolean;
  contentType?: string;
  contentLength?: number;
  eTag?: string;
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

class StorageService {
  private client: S3Client | null = null;

  private getClient(): S3Client {
    if (!this.client) {
      const hasExplicitEndpoint = Boolean(config.storage.r2Endpoint);
      this.client = new S3Client({
        region: config.storage.r2Region || 'auto',
        endpoint: buildR2Endpoint(),
        // Many S3-compatible providers (e.g., MinIO behind a custom domain) work best with path-style.
        forcePathStyle: hasExplicitEndpoint,
        credentials: {
          accessKeyId: config.storage.r2AccessKeyId,
          secretAccessKey: config.storage.r2SecretAccessKey,
        },
      });
    }

    return this.client;
  }

  private validateAssetRequest(input: PropertyUploadUrlInput): void {
    ensureR2Config();

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

  async createPropertyUploadUrl(input: PropertyUploadUrlInput): Promise<PropertyUploadUrlResult> {
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
      `${Date.now()}-${randomUUID()}-${cleanFileName}${extension}`,
    ].join('/');

    const uploadUrl = await getSignedUrl(
      this.getClient(),
      new PutObjectCommand({
        Bucket: config.storage.r2Bucket,
        Key: key,
        ContentType: input.mimeType,
      }),
      { expiresIn: 15 * 60 },
    );

    return {
      key,
      uploadUrl,
      publicUrl: this.getPublicUrl(key),
      expiresInSeconds: 15 * 60,
      contentType: input.mimeType,
    };
  }

  getPublicUrl(key: string): string {
    ensureR2Config();

    const configuredBaseUrl = (config.storage.r2PublicBaseUrl || '').trim();
    if (configuredBaseUrl) {
      return new URL(key, normalizeBaseUrl(configuredBaseUrl)).toString();
    }

    // Fallback: path-style URL against the R2 S3 endpoint.
    // Note: this may not be publicly accessible unless the bucket is configured for public reads.
    const endpoint = buildR2Endpoint();
    return new URL(`${config.storage.r2Bucket}/${key}`, normalizeBaseUrl(endpoint)).toString();
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    ensureR2Config();

    const response = await this.getClient().send(
      new GetObjectCommand({
        Bucket: config.storage.r2Bucket,
        Key: key,
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
    ensureR2Config();

    try {
      const metadata = await this.getClient().send(
        new HeadObjectCommand({
          Bucket: config.storage.r2Bucket,
          Key: key,
        }),
      );

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
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
        return { exists: false };
      }
      throw error;
    }
  }
}

export const storageService = new StorageService();
export { ensureR2Config };
