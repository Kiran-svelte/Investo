import config from '../config';
import logger from '../config/logger';
import prisma from '../config/prisma';
import { cacheGet, cacheSet, cacheDel } from '../config/redis';
import {
  fetchOpenAi,
  getOpenAiServiceHealth,
  isOpenAiHardDown,
  openAiApiKey,
  openAiKeyProblem,
  OPENAI_EMBEDDINGS_URL,
} from './openaiStatus.service';
import { isAwsStorageConfigured } from './storage.service';

const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_MAX_CHARS = 900;
const LOCAL_EMBEDDING_PROVIDER = 'local_hash';

export interface PropertyKnowledgeIndexResult {
  ok: boolean;
  propertyId: string;
  chunkCount: number;
  error?: string;
}

export interface PropertyKnowledgeChunk {
  propertyId: string;
  content: string;
  sourceType: string;
  score: number;
}

let schemaReady: boolean | null = null;

function embeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
}

function localEmbeddingFallbackEnabled(): boolean {
  return process.env.PROPERTY_KNOWLEDGE_LOCAL_EMBEDDINGS !== 'false';
}

function requireKnowledgeIndex(): boolean {
  return process.env.REQUIRE_PROPERTY_KNOWLEDGE_INDEX !== 'false';
}

function requireCloudStorageOnPublish(): boolean {
  if (process.env.REQUIRE_CLOUD_STORAGE_ON_PUBLISH === 'false') {
    return false;
  }
  return isAwsStorageConfigured() || process.env.REQUIRE_CLOUD_STORAGE_ON_PUBLISH === 'true';
}

function isCloudStorageKey(storageKey: string): boolean {
  return storageKey.startsWith('aws://') || storageKey.startsWith('r2://') || storageKey.startsWith('supabase://');
}

export async function ensurePropertyKnowledgeSchema(): Promise<void> {
  if (schemaReady === true) {
    return;
  }

  // uuid-ossp is required for uuid_generate_v4() used as the PRIMARY KEY default.
  // Both clientMemory and propertyKnowledge create tables with this default, so
  // each schema setup MUST ensure the extension exists independently.
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS property_knowledge_chunks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      source_type VARCHAR(40) NOT NULL,
      content TEXT NOT NULL,
      embedding vector(${EMBEDDING_DIMENSIONS}),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS property_knowledge_chunks_company_property_idx ON property_knowledge_chunks (company_id, property_id)`,
  );

  schemaReady = true;
}


function splitIntoChunks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_MAX_CHARS) {
      if (buffer) {
        chunks.push(buffer.trim());
        buffer = '';
      }
      for (let i = 0; i < paragraph.length; i += CHUNK_MAX_CHARS) {
        chunks.push(paragraph.slice(i, i + CHUNK_MAX_CHARS).trim());
      }
      continue;
    }

    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length > CHUNK_MAX_CHARS) {
      if (buffer) {
        chunks.push(buffer.trim());
      }
      buffer = paragraph;
    } else {
      buffer = candidate;
    }
  }

  if (buffer) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

function formatPrice(value: unknown): string {
  const num = typeof value === 'object' && value !== null && 'toNumber' in (value as object)
    ? Number((value as { toNumber: () => number }).toNumber())
    : Number(value);
  if (!Number.isFinite(num)) {
    return 'N/A';
  }
  if (num >= 10000000) {
    return `${(num / 10000000).toFixed(2)} Cr`;
  }
  if (num >= 100000) {
    return `${(num / 100000).toFixed(2)} L`;
  }
  return num.toLocaleString('en-IN');
}

function formatUnitConfigurations(draftData: Record<string, unknown>): string | null {
  const raw = draftData.unit_configurations ?? draftData.unitConfigurations ?? draftData.inventory_units;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const lines: string[] = [];
  let total = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const bhk = Number(record.bhk);
    const count = Number(record.count);
    if (!Number.isFinite(bhk) || !Number.isFinite(count) || count < 1) {
      continue;
    }
    total += count;
    const label = typeof record.unit_label === 'string' && record.unit_label.trim()
      ? record.unit_label.trim()
      : `${bhk} BHK`;
    const priceMin = Number(record.price_min ?? record.priceMin);
    const priceMax = Number(record.price_max ?? record.priceMax);
    const price =
      Number.isFinite(priceMin) && Number.isFinite(priceMax)
        ? ` (₹${priceMin.toLocaleString('en-IN')}–₹${priceMax.toLocaleString('en-IN')})`
        : '';
    lines.push(`${count}× ${label}${price}`);
  }

  if (lines.length === 0) {
    return null;
  }

  const propertyType = typeof draftData.property_type === 'string'
    ? draftData.property_type
    : typeof draftData.propertyType === 'string'
      ? draftData.propertyType
      : 'project';

  return `Unit inventory (${propertyType}, ${total} units): ${lines.join('; ')}`;
}

function serializeAmenities(amenities: unknown): string {
  if (Array.isArray(amenities)) {
    return amenities.map(String).filter(Boolean).join(', ');
  }
  if (typeof amenities === 'string') {
    try {
      const parsed = JSON.parse(amenities);
      return Array.isArray(parsed) ? parsed.map(String).join(', ') : amenities;
    } catch {
      return amenities;
    }
  }
  return '';
}

export function buildPropertyKnowledgeSections(input: {
  property: {
    id: string;
    name: string;
    builder?: string | null;
    locationCity?: string | null;
    locationArea?: string | null;
    locationPincode?: string | null;
    priceMin?: unknown;
    priceMax?: unknown;
    bedrooms?: number | null;
    propertyType?: string | null;
    amenities?: unknown;
    description?: string | null;
    reraNumber?: string | null;
    brochureUrl?: string | null;
    status?: string | null;
  };
  draftData?: Record<string, unknown>;
  mediaExtractions?: Array<{ assetType: string; fileName: string; extractedMetadata: Record<string, unknown> }>;
}): string[] {
  const sections: string[] = [];
  const p = input.property;

  const catalogFacts = [
    `Property: ${p.name}`,
    p.builder ? `Builder: ${p.builder}` : null,
    p.locationArea || p.locationCity
      ? `Location: ${[p.locationArea, p.locationCity, p.locationPincode].filter(Boolean).join(', ')}`
      : null,
    p.priceMin != null && p.priceMax != null
      ? `Price range: ₹${formatPrice(p.priceMin)} to ₹${formatPrice(p.priceMax)}`
      : null,
    p.bedrooms != null ? `Bedrooms: ${p.bedrooms} BHK` : null,
    p.propertyType ? `Type: ${p.propertyType}` : null,
    p.reraNumber ? `RERA: ${p.reraNumber}` : 'RERA: not in records',
    p.status ? `Status: ${p.status}` : null,
    serializeAmenities(p.amenities) ? `Amenities: ${serializeAmenities(p.amenities)}` : null,
    p.brochureUrl ? 'Brochure PDF: on file (sent as WhatsApp attachment, not a link)' : null,
  ].filter(Boolean) as string[];

  sections.push(catalogFacts.join('\n'));

  if (p.description?.trim()) {
    sections.push(`Description:\n${p.description.trim()}`);
  }

  if (input.draftData) {
    const marketing = input.draftData.ai_marketing_answers ?? input.draftData.aiMarketingAnswers;
    if (marketing && typeof marketing === 'object' && !Array.isArray(marketing)) {
      const lines = Object.entries(marketing as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
        .map(([k, v]) => `${k}: ${String(v)}`);
      if (lines.length > 0) {
        sections.push(`Marketing knowledge (admin confirmed):\n${lines.join('\n')}`);
      }
    }

    const unitInventory = formatUnitConfigurations(input.draftData);
    if (unitInventory) {
      sections.push(unitInventory);
    }

    const typeKnowledge = input.draftData.type_knowledge ?? input.draftData.typeKnowledge;
    if (typeKnowledge && typeof typeKnowledge === 'object' && !Array.isArray(typeKnowledge)) {
      const lines = Object.entries(typeKnowledge as Record<string, unknown>)
        .filter(([k, v]) => k !== 'anything_else_skipped' && v !== null && v !== undefined && String(v).trim() !== '')
        .map(([k, v]) => `${k}: ${String(v)}`);
      if (lines.length > 0) {
        sections.push(`Type-specific knowledge (admin confirmed):\n${lines.join('\n')}`);
      }
    }

    const reviewNotes = typeof input.draftData.review_notes === 'string' ? input.draftData.review_notes.trim() : '';
    if (reviewNotes) {
      sections.push(`Internal review notes:\n${reviewNotes}`);
    }

    const mapping = input.draftData.import_mapping || input.draftData.importMapping;
    if (mapping && typeof mapping === 'object') {
      const sourceRecord = (mapping as Record<string, unknown>).source_record;
      if (sourceRecord && typeof sourceRecord === 'object') {
        const lines = Object.entries(sourceRecord as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
          .map(([k, v]) => `${k}: ${String(v)}`);
        if (lines.length > 0) {
          sections.push(`Imported source fields:\n${lines.join('\n')}`);
        }
      }
    }
  }

  for (const media of input.mediaExtractions || []) {
    const meta = media.extractedMetadata || {};
    const textFields = ['summary', 'description', 'raw_text', 'extracted_text', 'project_name', 'highlights'];
    const lines = textFields
      .map((field) => (typeof meta[field] === 'string' && meta[field].trim() ? `${field}: ${meta[field].trim()}` : null))
      .filter(Boolean) as string[];

    const nested = meta.fields;
    if (nested && typeof nested === 'object') {
      for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
        if (v !== null && v !== undefined && String(v).trim() !== '') {
          lines.push(`${k}: ${String(v)}`);
        }
      }
    }

    if (lines.length > 0) {
      sections.push(`${media.assetType} extraction (${media.fileName}):\n${lines.join('\n')}`);
    }
  }

  return sections;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createLocalKnowledgeEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];

  if (tokens.length === 0) {
    vector[0] = 1;
    return vector;
  }

  for (const token of tokens) {
    const hash = hashString(token);
    const index = hash % EMBEDDING_DIMENSIONS;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function createLocalEmbeddings(texts: string[]): number[][] {
  return texts.map(createLocalKnowledgeEmbedding);
}

function fallbackEmbeddings(texts: string[], reason: string): number[][] {
  if (!localEmbeddingFallbackEnabled()) {
    throw new Error(`${reason} Local property knowledge embeddings are disabled.`);
  }

  // DEGRADED MODE: local hash embeddings have no semantic meaning.
  // Cosine similarity scores will be near-random, so RAG search results
  // will not be semantically relevant until OpenAI embeddings are restored.
  // This is logged at ERROR level so it surfaces in monitoring dashboards.
  logger.error('RAG quality degraded: using local hash embeddings (no semantic meaning)', {
    reason,
    provider: LOCAL_EMBEDDING_PROVIDER,
    count: texts.length,
    impact: 'vector similarity search results are near-random until OpenAI billing is restored',
  });

  return createLocalEmbeddings(texts);
}


async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const keyProblem = openAiKeyProblem();
  if (keyProblem) {
    return fallbackEmbeddings(texts, keyProblem);
  }

  let response: Response;
  try {
    response = await fetchOpenAi(
      OPENAI_EMBEDDINGS_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openAiApiKey()}`,
        },
        body: JSON.stringify({
          model: embeddingModel(),
          input: texts,
        }),
      },
      { retries: 2, label: 'property_knowledge_embeddings' },
    );
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!localEmbeddingFallbackEnabled()) {
      throw new Error(reason);
    }
    return fallbackEmbeddings(texts, reason);
  }

  const payload = await response.json() as {
    data?: Array<{ embedding: number[]; index: number }>;
  };

  const rows = payload.data || [];
  if (rows.length !== texts.length) {
    throw new Error('Embedding API returned unexpected row count');
  }

  return rows
    .sort((a, b) => a.index - b.index)
    .map((row) => {
      if (!Array.isArray(row.embedding) || row.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Embedding dimension mismatch (expected ${EMBEDDING_DIMENSIONS})`);
      }
      return row.embedding;
    });
}

export async function getPropertyKnowledgeEmbeddingHealth(): Promise<{
  status: 'ok' | 'degraded' | 'error';
  provider: 'openai' | 'local_hash';
  detail?: string;
}> {
  const openAiHealth = await getOpenAiServiceHealth();

  if (openAiHealth.status === 'ok') {
    return {
      status: 'ok',
      provider: 'openai',
      detail: 'OpenAI embeddings ready for publish and WhatsApp AI.',
    };
  }

  const hardDown = openAiHealth.failureKind && isOpenAiHardDown(openAiHealth.failureKind);

  if (localEmbeddingFallbackEnabled() && hardDown) {
    return {
      status: 'degraded',
      provider: LOCAL_EMBEDDING_PROVIDER,
      detail: `${openAiHealth.detail} Using local embeddings fallback until OpenAI billing is restored.`,
    };
  }

  if (localEmbeddingFallbackEnabled() && !hardDown) {
    return {
      status: 'ok',
      provider: LOCAL_EMBEDDING_PROVIDER,
      detail: `${openAiHealth.detail} Using local embeddings fallback (OpenAI temporarily unavailable).`,
    };
  }

  return {
    status: hardDown ? 'error' : 'degraded',
    provider: 'openai',
    detail: openAiHealth.detail,
  };
}

function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

/** Shared RAG embeddings for property + per-client memory. */
export async function createTextEmbeddings(texts: string[]): Promise<number[][]> {
  return createEmbeddings(texts);
}

export function embeddingVectorLiteral(values: number[]): string {
  return vectorLiteral(values);
}

export async function deletePropertyKnowledge(propertyId: string): Promise<void> {
  await ensurePropertyKnowledgeSchema();
  await prisma.$executeRawUnsafe(
    `DELETE FROM property_knowledge_chunks WHERE property_id = $1::uuid`,
    propertyId,
  );
}

export async function indexPropertyKnowledge(input: {
  companyId: string;
  property: {
    id: string;
    name: string;
    builder?: string | null;
    locationCity?: string | null;
    locationArea?: string | null;
    locationPincode?: string | null;
    priceMin?: unknown;
    priceMax?: unknown;
    bedrooms?: number | null;
    propertyType?: string | null;
    amenities?: unknown;
    description?: string | null;
    reraNumber?: string | null;
    brochureUrl?: string | null;
    status?: string | null;
  };
  draftData?: Record<string, unknown>;
  mediaExtractions?: Array<{ assetType: string; fileName: string; extractedMetadata: Record<string, unknown> }>;
}): Promise<PropertyKnowledgeIndexResult> {
  const propertyId = input.property.id;

  try {
    await ensurePropertyKnowledgeSchema();

    const sections = buildPropertyKnowledgeSections({
      property: input.property,
      draftData: input.draftData,
      mediaExtractions: input.mediaExtractions,
    });

    const chunks = sections.flatMap((section) => splitIntoChunks(section)).filter(Boolean);
    if (chunks.length === 0) {
      return {
        ok: false,
        propertyId,
        chunkCount: 0,
        error: 'No factual content available to index for this property',
      };
    }

    const embeddings = await createEmbeddings(chunks);

    await prisma.$executeRawUnsafe(
      `DELETE FROM property_knowledge_chunks WHERE property_id = $1::uuid`,
      propertyId,
    );

    for (let i = 0; i < chunks.length; i += 1) {
      const content = chunks[i];
      const embedding = embeddings[i];
      const metadata = JSON.stringify({
        property_name: input.property.name,
        chunk_index: i,
      });

      await prisma.$executeRawUnsafe(
        `INSERT INTO property_knowledge_chunks (
          company_id, property_id, source_type, content, embedding, metadata, updated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5::vector, $6::jsonb, now()
        )`,
        input.companyId,
        propertyId,
        'property_catalog',
        content,
        vectorLiteral(embedding),
        metadata,
      );
    }

    logger.info('Property knowledge indexed', {
      companyId: input.companyId,
      propertyId,
      chunkCount: chunks.length,
    });

    return { ok: true, propertyId, chunkCount: chunks.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Property knowledge indexing failed', {
      companyId: input.companyId,
      propertyId,
      error: message,
    });
    return { ok: false, propertyId, chunkCount: 0, error: message };
  }
}

/** Direct catalog chunks for one property (no vector search) — reliable for More Info / focused turns. */
const PROPERTY_KNOWLEDGE_CACHE_TTL = 300; // 5 minutes

/**
 * Invalidate the cached knowledge chunks for a specific property.
 * Call this whenever property knowledge is updated (new chunks indexed).
 */
export async function invalidatePropertyKnowledgeCache(companyId: string, propertyId: string): Promise<void> {
  const key = `prop-knowledge:${companyId}:${propertyId}`;
  await cacheDel(key).catch(() => undefined);
}

export async function getPropertyKnowledgeForProperty(
  companyId: string,
  propertyId: string,
  limit = 6,
): Promise<PropertyKnowledgeChunk[]> {
  // Cache key is deterministic — same company + property always returns same chunks
  const cacheKey = `prop-knowledge:${companyId}:${propertyId}:${limit}`;

  try {
    const cached = await cacheGet<PropertyKnowledgeChunk[]>(cacheKey);
    if (cached && Array.isArray(cached)) {
      return cached;
    }
  } catch {
    // Cache miss or error — proceed to DB
  }

  try {
    await ensurePropertyKnowledgeSchema();
    const rows = await prisma.$queryRawUnsafe<Array<{
      property_id: string;
      content: string;
      source_type: string;
    }>>(
      `SELECT property_id::text, content, source_type
       FROM property_knowledge_chunks
       WHERE company_id = $1::uuid AND property_id = $2::uuid
       ORDER BY created_at ASC
       LIMIT $3`,
      companyId,
      propertyId,
      limit,
    );

    const chunks: PropertyKnowledgeChunk[] = rows.map((row) => ({
      propertyId: row.property_id,
      content: row.content,
      sourceType: row.source_type,
      score: 1,
    }));

    // Cache result (5-min TTL) — property knowledge changes infrequently
    await cacheSet(cacheKey, chunks, PROPERTY_KNOWLEDGE_CACHE_TTL).catch(() => undefined);

    return chunks;
  } catch (err: unknown) {
    logger.warn('Property knowledge direct fetch failed', {
      companyId,
      propertyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function loadPropertyKnowledgeIndexPayload(
  companyId: string,
  propertyId: string,
): Promise<{
  draftData?: Record<string, unknown>;
  mediaExtractions?: Array<{ assetType: string; fileName: string; extractedMetadata: Record<string, unknown> }>;
}> {
  const draft = await prisma.propertyImportDraft.findFirst({
    where: { companyId, publishedPropertyId: propertyId },
    select: { id: true, draftData: true },
  });
  if (!draft) return {};

  const mediaRows = await prisma.propertyImportMedia.findMany({
    where: {
      companyId,
      draftId: draft.id,
      status: { in: ['extracted', 'verified'] },
    },
    select: {
      assetType: true,
      fileName: true,
      extractedMetadata: true,
    },
  });

  return {
    draftData: (draft.draftData ?? {}) as Record<string, unknown>,
    mediaExtractions: mediaRows.map((row) => ({
      assetType: row.assetType,
      fileName: row.fileName,
      extractedMetadata: (row.extractedMetadata ?? {}) as Record<string, unknown>,
    })),
  };
}

export async function searchPropertyKnowledge(
  companyId: string,
  query: string,
  limit = 8,
): Promise<PropertyKnowledgeChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  try {
    await ensurePropertyKnowledgeSchema();
    const [embedding] = await createEmbeddings([trimmed]);
    const rows = await prisma.$queryRawUnsafe<Array<{
      property_id: string;
      content: string;
      source_type: string;
      score: number;
    }>>(
      `SELECT property_id::text, content, source_type,
              1 - (embedding <=> $1::vector) AS score
       FROM property_knowledge_chunks
       WHERE company_id = $2::uuid
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      vectorLiteral(embedding),
      companyId,
      limit,
    );

    return rows.map((row) => ({
      propertyId: row.property_id,
      content: row.content,
      sourceType: row.source_type,
      score: Number(row.score),
    }));
  } catch (err: unknown) {
    logger.warn('Property knowledge search failed', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

const PROPERTY_TYPE_PATTERN = /\b(apartment|flat|villa|plot|land|commercial|shop|office)\b/i;

export function parseBedroomsFromQuery(query: string): number | null {
  const match = query.match(/\b(\d)\s*bhk\b/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

export function parsePropertyTypeFromQuery(query: string): string | null {
  const match = query.match(PROPERTY_TYPE_PATTERN);
  if (!match) {
    return null;
  }
  const token = match[1].toLowerCase();
  if (token === 'flat') {
    return 'apartment';
  }
  if (token === 'land') {
    return 'plot';
  }
  if (token === 'shop' || token === 'office') {
    return 'commercial';
  }
  return token;
}

export function parseLocationTokensFromQuery(query: string): string[] {
  const stop = new Set([
    'near', 'in', 'at', 'around', 'for', 'the', 'a', 'an', 'looking', 'want', 'need',
    'villa', 'apartment', 'flat', 'plot', 'land', 'commercial', 'property', 'project',
    'brochure', 'details', 'send', 'show', 'me', 'please', 'you', 'guys', 'have', 'any',
    'how', 'many', 'there', 'ongoing', 'these', 'those', 'this', 'that', 'could', 'would',
    'also', 'about', 'with', 'from', 'your', 'our', 'are', 'was', 'were', 'does', 'did',
  ]);
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
}

export async function getInventorySummary(companyId: string): Promise<{
  total: number;
  upcoming: number;
  byType: Record<string, number>;
}> {
  const rows = await prisma.property.findMany({
    where: { companyId, status: { in: ['available', 'upcoming'] } },
    select: { propertyType: true, status: true },
  });
  const byType: Record<string, number> = {};
  let upcoming = 0;
  for (const row of rows) {
    const type = row.propertyType || 'other';
    byType[type] = (byType[type] ?? 0) + 1;
    if (row.status === 'upcoming') upcoming += 1;
  }
  return { total: rows.length, upcoming, byType };
}

export async function matchCatalogPropertiesForQuery(input: {
  companyId: string;
  query: string;
  limit?: number;
}): Promise<Array<{
  id: string;
  name: string;
  propertyType: string | null;
  locationCity: string | null;
  locationArea: string | null;
  brochureUrl: string | null;
  status: string | null;
  bedrooms: number | null;
  priceMin: unknown;
  priceMax: unknown;
  score: number;
}>> {
  const limit = input.limit ?? 5;
  const propertyType = parsePropertyTypeFromQuery(input.query);
  const bedrooms = parseBedroomsFromQuery(input.query);
  const locationTokens = parseLocationTokensFromQuery(input.query);

  const where: Record<string, unknown> = {
    companyId: input.companyId,
    status: { in: ['available', 'upcoming'] },
  };
  if (propertyType) {
    where.propertyType = propertyType;
  }
  if (bedrooms != null) {
    where.bedrooms = bedrooms;
  }

  const candidates = await prisma.property.findMany({
    where: where as any,
    orderBy: { updatedAt: 'desc' },
    take: 40,
    select: {
      id: true,
      name: true,
      propertyType: true,
      locationCity: true,
      locationArea: true,
      brochureUrl: true,
      status: true,
      bedrooms: true,
      priceMin: true,
      priceMax: true,
      description: true,
    },
  });

  const hasStructuredFilter = Boolean(propertyType || bedrooms != null);

  const scored = candidates.map((p) => {
    const haystack = [
      p.name,
      p.locationCity,
      p.locationArea,
      p.description,
      p.propertyType,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let score = 0;
    if (propertyType && p.propertyType === propertyType) score += 2;
    if (bedrooms != null && p.bedrooms === bedrooms) score += 3;
    for (const token of locationTokens) {
      if (haystack.includes(token)) {
        score += 3;
      }
    }
    return { ...p, score };
  });

  const filtered = scored.filter((p) => {
    if (propertyType && p.propertyType !== propertyType) return false;
    if (bedrooms != null && p.bedrooms !== bedrooms) return false;
    if (p.score > 0) return true;
    if (!hasStructuredFilter && locationTokens.length === 0) return true;
    return false;
  });

  const seen = new Set<string>();
  return filtered
    .sort((a, b) => b.score - a.score)
    .filter((p) => {
      const nameKey = p.name.toLowerCase().trim();
      if (seen.has(p.id) || seen.has(`name:${nameKey}`)) return false;
      seen.add(p.id);
      seen.add(`name:${nameKey}`);
      return true;
    })
    .slice(0, limit);
}

export function formatKnowledgeContextForPrompt(chunks: PropertyKnowledgeChunk[]): string {
  if (chunks.length === 0) {
    return '';
  }

  const lines = chunks.map((chunk, index) => (
    `[${index + 1}] (property ${chunk.propertyId}, score ${chunk.score.toFixed(3)})\n${chunk.content}`
  ));

  return `## GROUNDED PROJECT KNOWLEDGE (vector retrieval — only cite facts from this block or AVAILABLE PROPERTIES)
${lines.join('\n\n')}

If the customer asks about a project and the fact is not in these blocks, say it is not in our current records. Do not invent prices, RERA, amenities, or possession dates.`;
}

export function assertPublishStorageReady(mediaStorageKeys: string[]): void {
  if (!requireCloudStorageOnPublish()) {
    return;
  }

  const nonCloud = mediaStorageKeys.filter((key) => !isCloudStorageKey(key));
  if (nonCloud.length > 0) {
    throw new Error(
      'Property media must be stored in AWS S3 (or R2/Supabase fallback), not database blobs. Configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY on the server, then re-upload assets.',
    );
  }
}

export async function assertPropertyKnowledgeReady(
  result: PropertyKnowledgeIndexResult,
): Promise<void> {
  if (!requireKnowledgeIndex()) {
    return;
  }

  if (!result.ok || result.chunkCount === 0) {
    throw new Error(
      result.error
        || 'AI knowledge indexing failed. Publishing was rolled back until embeddings are available.',
    );
  }
}
