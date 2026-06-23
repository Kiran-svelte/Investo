export const AWS_STORAGE_PREFIX = 'aws://';
export const R2_STORAGE_PREFIX = 'r2://';
export const SUPABASE_STORAGE_PREFIX = 'supabase://';
export const DB_PROPERTY_IMPORT_MEDIA_PREFIX = 'db/property-import-media/';

export type StorageProviderKind = 'aws' | 'r2' | 'supabase' | 'db' | 'legacy-r2';

/** Extract S3 object key from aws:// prefix, HTTPS URL, or path fragment. */
export function extractAwsObjectKeyFromReference(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  const fromPrefix = parseAwsStorageKey(trimmed);
  if (fromPrefix) return fromPrefix;

  const pathMatch = trimmed.match(
    /(?:^|\/)(investo\/)?companies\/[0-9a-f-]{36}\/properties\/[^/\s"'()]+(?:\/(?:image|brochure)\/[^?\s"'()]+)?/i,
  );
  if (pathMatch) {
    let path = pathMatch[0].replace(/^\//, '');
    if (!path.startsWith('investo/')) {
      path = `investo/${path.replace(/^investo\//, '')}`;
    }
    return path;
  }

  try {
    const normalized = trimmed.replace(/\.s3\.[a-z0-9-]+\.s3\./gi, '.s3.');
    const url = new URL(normalized.split(/\s/)[0]);
    if (!url.hostname.includes('amazonaws.com') && !url.hostname.includes('s3.')) {
      return null;
    }
    const key = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return key || null;
  } catch {
    return null;
  }
}

export function parseAwsStorageKey(key: string): string | null {
  if (!key.startsWith(AWS_STORAGE_PREFIX)) {
    return null;
  }
  const objectKey = key.slice(AWS_STORAGE_PREFIX.length).trim();
  return objectKey || null;
}

export function parseR2StorageKey(key: string): string | null {
  if (key.startsWith(R2_STORAGE_PREFIX)) {
    const objectKey = key.slice(R2_STORAGE_PREFIX.length).trim();
    return objectKey || null;
  }
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return null;
  }
  if (
    !key.startsWith(SUPABASE_STORAGE_PREFIX)
    && !key.startsWith(DB_PROPERTY_IMPORT_MEDIA_PREFIX)
    && !key.startsWith(AWS_STORAGE_PREFIX)
  ) {
    return key;
  }
  return null;
}

/** Extract R2 object key from r2:// prefix, path fragment, or R2 HTTPS URL. */
export function extractR2ObjectKeyFromReference(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  const fromPrefix = parseR2StorageKey(trimmed);
  if (fromPrefix) return fromPrefix;

  const pathMatch = trimmed.match(
    /(?:^|\/)(investo\/)?companies\/[0-9a-f-]{36}\/properties\/[^/\s"'()]+(?:\/(?:image|brochure)\/[^?\s"'()]+)?/i,
  );
  if (pathMatch) {
    let path = pathMatch[0].replace(/^\//, '');
    if (!path.startsWith('investo/')) {
      path = `investo/${path.replace(/^investo\//, '')}`;
    }
    return path;
  }

  try {
    const url = new URL(trimmed.split(/\s/)[0]);
    if (!url.hostname.includes('r2.cloudflarestorage.com') && !url.hostname.endsWith('.r2.dev')) {
      return null;
    }
    const segments = decodeURIComponent(url.pathname.replace(/^\//, '')).split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const keyParts = segments.slice(1);
    const key = keyParts.join('/');
    return key || null;
  } catch {
    return null;
  }
}

export function parseSupabaseStorageKey(key: string): { bucket: string; objectPath: string } | null {
  if (!key.startsWith(SUPABASE_STORAGE_PREFIX)) {
    return null;
  }
  const remainder = key.slice(SUPABASE_STORAGE_PREFIX.length);
  const slash = remainder.indexOf('/');
  if (slash <= 0) {
    return null;
  }
  return {
    bucket: remainder.slice(0, slash),
    objectPath: remainder.slice(slash + 1),
  };
}

export function isDbPropertyImportMediaKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(DB_PROPERTY_IMPORT_MEDIA_PREFIX);
}

export function resolveStorageProviderKind(key: string): StorageProviderKind {
  if (parseAwsStorageKey(key)) {
    return 'aws';
  }
  if (parseSupabaseStorageKey(key)) {
    return 'supabase';
  }
  if (isDbPropertyImportMediaKey(key)) {
    return 'db';
  }
  if (parseR2StorageKey(key)) {
    return key.startsWith(R2_STORAGE_PREFIX) ? 'r2' : 'legacy-r2';
  }
  return 'legacy-r2';
}
