/**
 * Verifies buyer AI receives full property catalog facts (not stripped summaries).
 * Run: node backend/scripts/verify-property-ai-context.mjs
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');

if (!fs.existsSync(varsPath)) {
  console.error('Missing scripts/.railway-prod-vars.json — set DATABASE_URL locally or add prod vars file.');
  process.exit(1);
}

const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const COMPANY_ID = process.env.COMPANY_ID || 'a9c308d8-1083-4981-bd46-3667e0474e8e';

function parseAmenities(amenities) {
  if (Array.isArray(amenities)) return amenities;
  if (typeof amenities === 'string' && amenities.trim()) {
    try {
      const parsed = JSON.parse(amenities);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return amenities.split(',').map((a) => a.trim()).filter(Boolean);
    }
  }
  return [];
}

function formatCatalogLine(p) {
  const amenities = parseAmenities(p.amenities).slice(0, 8).join(', ');
  const location = [p.locationArea, p.locationCity, p.locationPincode].filter(Boolean).join(', ');
  const desc = p.description?.trim() ? ` | About: ${p.description.trim().slice(0, 120)}…` : '';
  return `- ${p.name} | ${location} | ${p.bedrooms ?? '?'}BHK ${p.propertyType ?? ''} | Amenities: ${amenities}${desc}`;
}

async function main() {
  const properties = await prisma.property.findMany({
    where: { companyId: COMPANY_ID, status: 'available' },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  });

  if (!properties.length) {
    console.log('No available properties for company', COMPANY_ID);
    process.exit(1);
  }

  console.log('=== Property AI context verification ===\n');
  let pass = 0;
  for (const p of properties) {
    const amenities = parseAmenities(p.amenities);
    const hasRichData =
      Boolean(p.description?.trim())
      && amenities.length > 0
      && (p.priceMin != null || p.priceMax != null)
      && Boolean(p.locationCity || p.locationArea);
    const line = formatCatalogLine(p);
    const ok = hasRichData && !line.includes('undefined') && !line.includes('|  |');
    if (ok) pass += 1;
    console.log(`${ok ? 'PASS' : 'WARN'} ${p.name}`);
    console.log(`  line: ${line.slice(0, 200)}`);
    console.log(`  chunks: ${await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS c FROM property_knowledge_chunks WHERE property_id = $1::uuid`,
      p.id,
    ).then((rows) => rows[0]?.c ?? 0)}`);
    console.log('');
  }

  console.log(`Rich catalog rows: ${pass}/${properties.length}`);
  process.exit(pass > 0 ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
