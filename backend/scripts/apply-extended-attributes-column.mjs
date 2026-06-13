import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const varsPath = path.join(__dirname, '../../scripts/.railway-prod-vars.json');
const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

try {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE properties
      ADD COLUMN IF NOT EXISTS extended_attributes JSONB NOT NULL DEFAULT '{}'::jsonb
  `);
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'properties' AND column_name = 'extended_attributes'
  `);
  console.log('extended_attributes present:', cols.length > 0);
} finally {
  await prisma.$disconnect();
}
