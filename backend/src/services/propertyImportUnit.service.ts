import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';

export interface PropertyImportUnitInput {
  label?: string | null;
  unitData: Record<string, unknown>;
  sortOrder?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeUnitLabel(value: unknown, fallbackIndex: number): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return `Unit ${fallbackIndex + 1}`;
}

export function normalizeExtractedUnits(
  units: unknown,
  projectData: Record<string, unknown>,
): PropertyImportUnitInput[] {
  if (!Array.isArray(units) || units.length === 0) {
    return [];
  }

  return units
    .map((item, index) => {
      const record = asRecord(item);
      const unitData = {
        ...projectData,
        ...record,
        name: record.name ?? record.unit_name ?? record.title ?? record.label ?? projectData.name,
      };
      const label = normalizeUnitLabel(record.label ?? record.name ?? record.unit_name, index);
      return {
        label,
        unitData,
        sortOrder: index,
      };
    })
    .filter((item) => Object.keys(item.unitData).length > 0);
}

export async function syncPropertyImportUnits(
  companyId: string,
  draftId: string,
  units: PropertyImportUnitInput[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.propertyImportUnit.deleteMany({
      where: { draftId, companyId, status: { not: 'published' } },
    });

    if (units.length === 0) {
      return;
    }

    await tx.propertyImportUnit.createMany({
      data: units.map((unit, index) => ({
        companyId,
        draftId,
        label: unit.label ?? `Unit ${index + 1}`,
        unitData: unit.unitData as Prisma.InputJsonValue,
        sortOrder: unit.sortOrder ?? index,
        status: 'draft',
      })),
    });
  });
}

export async function listPropertyImportUnits(companyId: string, draftId: string) {
  return prisma.propertyImportUnit.findMany({
    where: { companyId, draftId },
    orderBy: { sortOrder: 'asc' },
  });
}

export function buildBatchProgress(unitsTotal: number, phase: string, extra?: Record<string, unknown>) {
  return {
    phase,
    units_total: unitsTotal,
    units_ready: unitsTotal,
    units_published: 0,
    message: unitsTotal > 1 ? `${unitsTotal} villas loaded` : unitsTotal === 1 ? '1 unit loaded' : 'Extraction complete',
    updated_at: new Date().toISOString(),
    ...extra,
  };
}
