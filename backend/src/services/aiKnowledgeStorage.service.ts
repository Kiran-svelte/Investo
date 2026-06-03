import config from '../config';
import logger from '../config/logger';
import {
  downloadFromSupabaseBucket,
  isSupabaseStorageConfigured,
  uploadToSupabaseBucket,
} from './supabaseStorage.service';

const SUPABASE_AI_PREFIX = 'supabase://';

function aiKnowledgeObjectPath(companyId: string): string {
  return `companies/${companyId}/faq-knowledge.json`;
}

function toStorageKey(companyId: string): string {
  const bucket = config.storage.supabaseAiKnowledgeBucket;
  return `${SUPABASE_AI_PREFIX}${bucket}/${aiKnowledgeObjectPath(companyId)}`;
}

function parseStorageKey(key: string): { bucket: string; objectPath: string } | null {
  if (!key.startsWith(SUPABASE_AI_PREFIX)) {
    return null;
  }
  const remainder = key.slice(SUPABASE_AI_PREFIX.length);
  const slash = remainder.indexOf('/');
  if (slash <= 0) {
    return null;
  }
  return {
    bucket: remainder.slice(0, slash),
    objectPath: remainder.slice(slash + 1),
  };
}

export async function syncFaqKnowledgeToSupabase(companyId: string, faqKnowledge: unknown): Promise<string | null> {
  if (!isSupabaseStorageConfigured()) {
    return null;
  }

  const bucket = config.storage.supabaseAiKnowledgeBucket;
  const objectPath = aiKnowledgeObjectPath(companyId);
  const bytes = Buffer.from(JSON.stringify(faqKnowledge ?? []), 'utf8');

  await uploadToSupabaseBucket(bucket, objectPath, bytes, 'application/json');
  const key = toStorageKey(companyId);
  logger.info('AI FAQ knowledge synced to Supabase storage', { companyId, bucket, objectPath });
  return key;
}

export async function loadFaqKnowledgeFromSupabase(companyId: string): Promise<unknown[] | null> {
  if (!isSupabaseStorageConfigured()) {
    return null;
  }

  const bucket = config.storage.supabaseAiKnowledgeBucket;
  const objectPath = aiKnowledgeObjectPath(companyId);

  try {
    const bytes = await downloadFromSupabaseBucket(bucket, objectPath);
    const parsed = JSON.parse(bytes.toString('utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    logger.debug('No Supabase FAQ knowledge object for company', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export { parseStorageKey, toStorageKey };
