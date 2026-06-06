import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const cid = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
try {
  const props = await prisma.property.count({ where: { companyId: cid } });
  const visits = await prisma.visit.count({ where: { lead: { companyId: cid } } });
  console.log(JSON.stringify({ properties: props, visits }));
} finally {
  await prisma.$disconnect();
}
