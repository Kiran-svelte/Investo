import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8'));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const name = process.argv[2] || 'Sunset Heights';
const p = await prisma.property.findFirst({ where: { name: { contains: name } }, orderBy: { updatedAt: 'desc' } });
if (!p) {
  console.log('Property not found');
  process.exit(1);
}
const chunks = await prisma.$queryRawUnsafe(
  'SELECT LEFT(content, 500) AS preview FROM property_knowledge_chunks WHERE property_id = $1::uuid ORDER BY created_at ASC LIMIT 3',
  p.id,
);
console.log({ id: p.id, name: p.name, description: p.description?.slice(0, 120), amenities: p.amenities, locationArea: p.locationArea });
for (const [i, c] of chunks.entries()) console.log(`\n--- chunk ${i + 1} ---\n${c.preview}`);
await prisma.$disconnect();
