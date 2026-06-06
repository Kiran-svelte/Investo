import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'leads' AND indexdef ILIKE '%company%phone%'
  `);
  console.log('lead indexes', rows);
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name IN ('lead_memory','metadata')
  `);
  console.log('lead cols', cols);
} finally {
  await prisma.$disconnect();
}
