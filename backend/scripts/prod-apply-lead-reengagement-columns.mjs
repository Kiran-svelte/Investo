import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const statements = [
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS re_engagement_sent_at TIMESTAMP`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS re_engagement_count INTEGER NOT NULL DEFAULT 0`,
];

for (const sql of statements) {
  await prisma.$executeRawUnsafe(sql);
  console.log('OK:', sql.slice(0, 60));
}

await prisma.$disconnect();
