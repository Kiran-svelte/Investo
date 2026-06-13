#!/usr/bin/env node
/**
 * Re-index property knowledge for all (or one company's) published properties.
 *
 * Usage:
 *   node backend/scripts/reindex-property-knowledge.mjs
 *   DRY_RUN=true node backend/scripts/reindex-property-knowledge.mjs
 *   COMPANY_ID=<uuid> node backend/scripts/reindex-property-knowledge.mjs
 */

import { PrismaClient } from '@prisma/client';

const dryRun = process.env.DRY_RUN === 'true';
const companyId = process.env.COMPANY_ID?.trim() || null;

const prisma = new PrismaClient();

async function main() {
  const properties = await prisma.property.findMany({
    where: {
      ...(companyId ? { companyId } : {}),
      status: { in: ['available', 'upcoming', 'sold'] },
    },
    select: {
      id: true,
      name: true,
      companyId: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  console.log(`Found ${properties.length} properties to re-index (dryRun=${dryRun})`);

  if (dryRun) {
    for (const property of properties.slice(0, 10)) {
      console.log(`  would re-index: ${property.name} (${property.id})`);
    }
    if (properties.length > 10) {
      console.log(`  ... and ${properties.length - 10} more`);
    }
    return;
  }

  const { indexPropertyKnowledge, loadPropertyKnowledgeIndexPayload } = await import('../dist/services/propertyKnowledge.service.js');

  let ok = 0;
  let failed = 0;
  for (const property of properties) {
    try {
      const full = await prisma.property.findFirst({ where: { id: property.id } });
      if (!full) continue;
      const payload = await loadPropertyKnowledgeIndexPayload(property.companyId, property.id);
      const result = await indexPropertyKnowledge({
        companyId: property.companyId,
        property: full,
        draftData: payload.draftData,
        mediaExtractions: payload.mediaExtractions,
      });
      if (result.ok) {
        ok += 1;
        console.log(`OK ${property.name} (${result.chunkCount} chunks)`);
      } else {
        failed += 1;
        console.warn(`FAIL ${property.name}: ${result.error ?? 'unknown'}`);
      }
    } catch (err) {
      failed += 1;
      console.warn(`FAIL ${property.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`Done. indexed=${ok} failed=${failed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
