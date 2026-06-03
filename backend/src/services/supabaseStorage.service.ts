import config from '../config';
import logger from '../config/logger';

function getServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
}

export function isSupabaseStorageConfigured(): boolean {
  return Boolean(config.supabase.url && getServiceRoleKey());
}

export async function uploadToSupabaseBucket(
  bucket: string,
  objectPath: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ publicUrl: string }> {
  const baseUrl = config.supabase.url;
  const key = getServiceRoleKey();
  if (!baseUrl || !key) {
    throw new Error('Supabase storage is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)');
  }

  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const url = `${baseUrl}/storage/v1/object/${bucket}/${encodedPath}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: bytes,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upload failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const publicUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`;
  logger.info('Supabase storage upload complete', { bucket, objectPath });
  return { publicUrl };
}

export async function downloadFromSupabaseBucket(bucket: string, objectPath: string): Promise<Buffer> {
  const baseUrl = config.supabase.url;
  const key = getServiceRoleKey();
  if (!baseUrl || !key) {
    throw new Error('Supabase storage is not configured');
  }

  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const url = `${baseUrl}/storage/v1/object/${bucket}/${encodedPath}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase download failed (${res.status})`);
  }

  return Buffer.from(await res.arrayBuffer());
}
