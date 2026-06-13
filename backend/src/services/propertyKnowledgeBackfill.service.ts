import cron from 'node-cron';
import logger from '../config/logger';
import prisma from '../config/prisma';
import {
  indexPropertyKnowledge,
  loadPropertyKnowledgeIndexPayload,
} from './propertyKnowledge.service';

const BATCH_LIMIT = (() => {
  const raw = process.env.PROPERTY_KNOWLEDGE_BOOT_BATCH_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : 200;
  return Number.isFinite(parsed) ? Math.min(500, Math.max(10, parsed)) : 200;
})();

const BATCH_PAUSE_MS = (() => {
  const raw = process.env.PROPERTY_KNOWLEDGE_BATCH_PAUSE_MS;
  const parsed = raw ? parseInt(raw, 10) : 5_000;
  return Number.isFinite(parsed) ? Math.min(60_000, Math.max(1_000, parsed)) : 5_000;
})();

/** Per deploy boot sweep cap; 0 = run until queue empty (hard-capped at 500 batches). */
const BOOT_MAX_BATCHES = (() => {
  const raw = process.env.PROPERTY_KNOWLEDGE_BOOT_MAX_BATCHES;
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(0, parsed)) : 0;
})();

/** Nightly cron sweep cap; default drains up to 50k properties per night. */
const NIGHTLY_MAX_BATCHES = (() => {
  const raw = process.env.PROPERTY_KNOWLEDGE_NIGHTLY_MAX_BATCHES;
  const parsed = raw ? parseInt(raw, 10) : 250;
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, parsed)) : 250;
})();

const ABSOLUTE_MAX_BATCHES = 500;

/**
 * Platform-wide: any tenant property missing rich import knowledge or stale vs catalog.
 * No company_id filter — every company/project/property is eligible.
 */
const CANDIDATE_WHERE_SQL = `
  p.status IN ('available', 'upcoming')
  AND (
    NOT EXISTS (
      SELECT 1 FROM property_knowledge_chunks c WHERE c.property_id = p.id
    )
    OR NOT EXISTS (
      SELECT 1 FROM property_knowledge_chunks c
      WHERE c.property_id = p.id
      AND (
        c.content ILIKE '%Imported property attributes%'
        OR c.content ILIKE '%Carpet area%'
        OR c.content ILIKE '%Spreadsheet inventory summary%'
      )
    )
    OR (
      p.extended_attributes IS NOT NULL
      AND p.extended_attributes::text NOT IN ('{}', 'null')
      AND NOT EXISTS (
        SELECT 1 FROM property_knowledge_chunks c
        WHERE c.property_id = p.id
        AND c.content ILIKE '%Imported property attributes%'
      )
    )
    OR (
      EXISTS (SELECT 1 FROM property_knowledge_chunks c WHERE c.property_id = p.id)
      AND p.updated_at > (
        SELECT COALESCE(MAX(c.updated_at), '1970-01-01'::timestamptz)
        FROM property_knowledge_chunks c
        WHERE c.property_id = p.id
      ) + interval '5 minutes'
    )
  )
`;

export type PropertyKnowledgeBackfillBatchResult = {
  processed: number;
  ok: number;
  failed: number;
  hasMore: boolean;
};

let sweepRunning = false;
let maintenanceCronStarted = false;

export async function countPropertyKnowledgeBackfillCandidates(): Promise<number> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM properties p WHERE ${CANDIDATE_WHERE_SQL}`,
    );
    return Number(rows[0]?.count ?? 0);
  } catch (err: unknown) {
    logger.warn('Property knowledge backfill count failed; using legacy candidate query', {
      error: err instanceof Error ? err.message : String(err),
    });
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM properties p
       WHERE p.status IN ('available', 'upcoming')
       AND (
         NOT EXISTS (SELECT 1 FROM property_knowledge_chunks c WHERE c.property_id = p.id)
         OR NOT EXISTS (
           SELECT 1 FROM property_knowledge_chunks c
           WHERE c.property_id = p.id
           AND (
             c.content ILIKE '%Imported property attributes%'
             OR c.content ILIKE '%Carpet area%'
             OR c.content ILIKE '%Spreadsheet inventory summary%'
           )
         )
       )`,
    );
    return Number(rows[0]?.count ?? 0);
  }
}

export async function runPropertyKnowledgeBackfillBatch(): Promise<PropertyKnowledgeBackfillBatchResult> {
  let candidates: Array<{ id: string; company_id: string; name: string }>;
  try {
    candidates = await prisma.$queryRawUnsafe(
      `SELECT p.id::text AS id, p.company_id::text AS company_id, p.name
       FROM properties p
       WHERE ${CANDIDATE_WHERE_SQL}
       ORDER BY p.updated_at DESC
       LIMIT $1`,
      BATCH_LIMIT,
    );
  } catch (err: unknown) {
    logger.warn('Property knowledge backfill batch query failed; using legacy candidate query', {
      error: err instanceof Error ? err.message : String(err),
    });
    candidates = await prisma.$queryRawUnsafe(
      `SELECT p.id::text AS id, p.company_id::text AS company_id, p.name
       FROM properties p
       WHERE p.status IN ('available', 'upcoming')
       AND (
         NOT EXISTS (SELECT 1 FROM property_knowledge_chunks c WHERE c.property_id = p.id)
         OR NOT EXISTS (
           SELECT 1 FROM property_knowledge_chunks c
           WHERE c.property_id = p.id
           AND (
             c.content ILIKE '%Imported property attributes%'
             OR c.content ILIKE '%Carpet area%'
             OR c.content ILIKE '%Spreadsheet inventory summary%'
           )
         )
       )
       ORDER BY p.updated_at DESC
       LIMIT $1`,
      BATCH_LIMIT,
    );
  }

  if (!candidates.length) {
    return { processed: 0, ok: 0, failed: 0, hasMore: false };
  }

  let ok = 0;
  let failed = 0;

  for (const row of candidates) {
    try {
      const property = await prisma.property.findFirst({
        where: { id: row.id, companyId: row.company_id },
      });
      if (!property) continue;

      const payload = await loadPropertyKnowledgeIndexPayload(row.company_id, row.id);
      const result = await indexPropertyKnowledge({
        companyId: row.company_id,
        property: {
          id: property.id,
          name: property.name,
          builder: property.builder,
          locationCity: property.locationCity,
          locationArea: property.locationArea,
          locationPincode: property.locationPincode,
          priceMin: property.priceMin,
          priceMax: property.priceMax,
          bedrooms: property.bedrooms,
          propertyType: property.propertyType,
          amenities: property.amenities,
          description: property.description,
          reraNumber: property.reraNumber,
          brochureUrl: property.brochureUrl,
          status: property.status,
        },
        draftData: payload.draftData,
        mediaExtractions: payload.mediaExtractions,
      });

      if (result.ok) ok += 1;
      else failed += 1;
    } catch (err: unknown) {
      failed += 1;
      logger.warn('Property knowledge backfill row failed', {
        propertyId: row.id,
        companyId: row.company_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    processed: candidates.length,
    ok,
    failed,
    hasMore: candidates.length >= BATCH_LIMIT,
  };
}

export async function runPlatformPropertyKnowledgeSweep(options?: {
  label?: string;
  maxBatches?: number;
  batchPauseMs?: number;
}): Promise<{ batches: number; totalOk: number; totalFailed: number; remaining: number }> {
  if (sweepRunning) {
    logger.info('Property knowledge sweep skipped — already running');
    const remaining = await countPropertyKnowledgeBackfillCandidates();
    return { batches: 0, totalOk: 0, totalFailed: 0, remaining };
  }

  sweepRunning = true;
  const label = options?.label ?? 'platform-sweep';
  const maxBatches = Math.min(
    options?.maxBatches ?? (BOOT_MAX_BATCHES === 0 ? ABSOLUTE_MAX_BATCHES : BOOT_MAX_BATCHES),
    ABSOLUTE_MAX_BATCHES,
  );
  const pauseMs = options?.batchPauseMs ?? BATCH_PAUSE_MS;

  let batches = 0;
  let totalOk = 0;
  let totalFailed = 0;

  try {
    const queueStart = await countPropertyKnowledgeBackfillCandidates();
    if (!queueStart) {
      logger.info('Property knowledge sweep: queue empty', { label });
      return { batches: 0, totalOk: 0, totalFailed: 0, remaining: 0 };
    }

    logger.info('Property knowledge sweep started', { label, queueStart, maxBatches, batchSize: BATCH_LIMIT });

    while (batches < maxBatches) {
      const batch = await runPropertyKnowledgeBackfillBatch();
      batches += 1;
      totalOk += batch.ok;
      totalFailed += batch.failed;

      if (!batch.hasMore) break;
      await new Promise((r) => setTimeout(r, pauseMs));
    }

    const remaining = await countPropertyKnowledgeBackfillCandidates();
    logger.info('Property knowledge sweep complete', {
      label,
      batches,
      totalOk,
      totalFailed,
      remaining,
    });

    return { batches, totalOk, totalFailed, remaining };
  } catch (err: unknown) {
    logger.warn('Property knowledge sweep aborted', {
      label,
      error: err instanceof Error ? err.message : String(err),
    });
    const remaining = await countPropertyKnowledgeBackfillCandidates().catch(() => -1);
    return { batches, totalOk, totalFailed, remaining };
  } finally {
    sweepRunning = false;
  }
}

/**
 * On deploy: drain the platform-wide backfill queue in the background.
 * Runs across all companies — no manual per-property intervention.
 */
export async function backfillPropertyKnowledgeOnBoot(): Promise<void> {
  if (process.env.PROPERTY_KNOWLEDGE_BOOT_BACKFILL === 'false') return;

  const maxBatches = BOOT_MAX_BATCHES === 0 ? ABSOLUTE_MAX_BATCHES : BOOT_MAX_BATCHES;
  await runPlatformPropertyKnowledgeSweep({ label: 'boot', maxBatches });
}

async function runNightlyPropertyKnowledgeSweep(): Promise<void> {
  if (process.env.PROPERTY_KNOWLEDGE_NIGHTLY_BACKFILL === 'false') return;
  await runPlatformPropertyKnowledgeSweep({ label: 'nightly', maxBatches: NIGHTLY_MAX_BATCHES });
}

/**
 * Nightly platform maintenance — 2:20 AM IST (20:50 UTC).
 * Independent of per-tenant operations; catches anything missed by publish/update paths.
 */
export function startPropertyKnowledgeMaintenanceCron(): void {
  if (maintenanceCronStarted || process.env.PROPERTY_KNOWLEDGE_NIGHTLY_BACKFILL === 'false') return;
  maintenanceCronStarted = true;

  cron.schedule('50 20 * * *', () => {
    void runNightlyPropertyKnowledgeSweep();
  });

  logger.info('Property knowledge maintenance cron started', {
    schedule: '50 20 * * *',
    nightlyMaxBatches: NIGHTLY_MAX_BATCHES,
    batchSize: BATCH_LIMIT,
  });
}
