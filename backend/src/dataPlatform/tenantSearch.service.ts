import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

export interface TenantSearchResult {
  entity_type: string;
  entity_id: string;
  title: string;
  snippet: string;
  score: number;
}

export class TenantSearchService {
  isEnabled(): boolean {
    return config.features.tenantSearch === true;
  }

  async search(companyId: string, query: string, limit = 20): Promise<TenantSearchResult[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const q = query.trim();
    if (!q) return [];

    const [leads, properties] = await Promise.all([
      prismaClient().lead.findMany({
        where: {
          companyId,
          OR: [
            { customerName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: { id: true, customerName: true, phone: true },
      }),
      prismaClient().property.findMany({
        where: {
          companyId,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { locationCity: { contains: q, mode: 'insensitive' } },
            { locationArea: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: { id: true, name: true, locationCity: true, locationArea: true },
      }),
    ]);

    const results: TenantSearchResult[] = [];

    for (const lead of leads) {
      results.push({
        entity_type: 'lead',
        entity_id: lead.id,
        title: lead.customerName || lead.phone,
        snippet: lead.phone,
        score: 0.9,
      });
    }

    for (const property of properties) {
      results.push({
        entity_type: 'property',
        entity_id: property.id,
        title: property.name,
        snippet: [property.locationArea, property.locationCity].filter(Boolean).join(', '),
        score: 0.8,
      });
    }

    return results.slice(0, limit);
  }
}

export const tenantSearchService = new TenantSearchService();
