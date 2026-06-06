import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

try {
  const dups = await prisma.$queryRawUnsafe(`
    SELECT company_id, phone, COUNT(*)::int AS c
    FROM leads
    WHERE phone IS NOT NULL
    GROUP BY company_id, phone
    HAVING COUNT(*) > 1
    LIMIT 10
  `);
  console.log('duplicate lead groups', dups);

  await prisma.$executeRawUnsafe(`
    DELETE FROM leads l1
    USING leads l2
    WHERE l1.company_id = l2.company_id
      AND l1.phone = l2.phone
      AND l1.created_at > l2.created_at
  `);
  console.log('deduped leads');

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE leads ADD CONSTRAINT leads_company_id_phone_key UNIQUE (company_id, phone)
    `);
    console.log('added unique constraint');
  } catch (e) {
    console.log('unique constraint:', e.message?.slice?.(0, 120) || e);
  }
} finally {
  await prisma.$disconnect();
}
