import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const varsPath = path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json');
const raw = fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, '');
const vars = JSON.parse(raw);
const sqlPath = path.join(path.resolve(import.meta.dirname, '..'), 'prisma/migrations/20260606000000_add_workflow_saga_tables/migration.sql');

const adapter = new PrismaPg({ connectionString: vars.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

try {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await prisma.$executeRawUnsafe(sql);
  console.log('Applied saga migration SQL to prod');
} finally {
  await prisma.$disconnect();
}
