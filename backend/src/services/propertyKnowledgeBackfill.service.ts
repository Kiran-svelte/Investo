import logger from '../config/logger';
import prisma from '../config/prisma';
import {
  indexPropertyKnowledge,
  loadPropertyKnowledgeIndexPayload,
} from './propertyKnowledge.service';

const BOOT_BATCH_LIMIT = (() => {
  const raw = process.env.PROPERTY_KNOWLEDGE_BOOT_BATCH_LIMIT;
  const parsed = raw ? parseInt(raw, 10) : 200;
  return Number.isFinite(parsed) ? Math.min(500, Math.max(10, parsed)) : 200;
})();

/**
 * On deploy, re-index properties whose knowledge is missing or still sparse (pre-full-import).
 * Runs in background — does not block API startup.
 */
export async function backfillPropertyKnowledgeOnBoot(): Promise<void> {
  if (process.env.PROPERTY_KNOWLEDGE_BOOT_BACKFILL === 'false') {
    return;
  }

  try {
    const candidates = await prisma.$queryRawUnsafe<Array<{ id: string; company_id: string; name: string }>>(
      `SELECT p.id::text AS id, p.company_id::text AS company_id, p.name
       FROM properties p
       WHERE p.status IN ('available', 'upcoming')
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
       )
       ORDER BY p.updated_at DESC
       LIMIT $1`,
      BOOT_BATCH_LIMIT,
    );

    if (!candidates.length) {
      logger.info('Property knowledge boot backfill: nothing to re-index');
      return;
    }

    logger.info('Property knowledge boot backfill started', { count: candidates.length });

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

        if (result.ok) {
          ok += 1;
        } else {
          failed += 1;
        }
      } catch (err: unknown) {
        failed += 1;
        logger.warn('Property knowledge boot backfill row failed', {
          propertyId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Property knowledge boot backfill complete', { ok, failed, total: candidates.length });
  } catch (err: unknown) {
    logger.warn('Property knowledge boot backfill aborted', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
