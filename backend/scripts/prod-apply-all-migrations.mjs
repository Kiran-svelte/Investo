import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const migDir = path.join(path.resolve(import.meta.dirname, '..'), 'prisma/migrations');
const dirs = fs.readdirSync(migDir).filter((d) => fs.existsSync(path.join(migDir, d, 'migration.sql'))).sort();

try {
  for (const d of dirs) {
    const sql = fs.readFileSync(path.join(migDir, d, 'migration.sql'), 'utf8');
    await prisma.$executeRawUnsafe(sql);
    console.log('applied', d);
  }
} finally {
  await prisma.$disconnect();
}
