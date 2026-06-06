import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const sql = fs.readFileSync(path.join(path.resolve(import.meta.dirname, '..'), 'prisma/migrations/20260605230000_add_inbound_whatsapp_dedup/migration.sql'), 'utf8');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
try {
  await prisma.$executeRawUnsafe(sql);
  console.log('inbound_whatsapp_dedup applied');
} finally {
  await prisma.$disconnect();
}
