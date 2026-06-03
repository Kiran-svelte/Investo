export const AWS_STORAGE_PREFIX = 'aws://';
export const R2_STORAGE_PREFIX = 'r2://';
export const SUPABASE_STORAGE_PREFIX = 'supabase://';
export const DB_PROPERTY_IMPORT_MEDIA_PREFIX = 'db/property-import-media/';

export type StorageProviderKind = 'aws' | 'r2' | 'supabase' | 'db' | 'legacy-r2';

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
  if (
    !key.startsWith(SUPABASE_STORAGE_PREFIX)
    && !key.startsWith(DB_PROPERTY_IMPORT_MEDIA_PREFIX)
    && !key.startsWith(AWS_STORAGE_PREFIX)
  ) {
    return key;
  }
  return null;
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
