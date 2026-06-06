import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const varsPath = path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json');
const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
try {
  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { id: true, phone: true, customerName: true, createdAt: true, companyId: true },
  });
  console.log(JSON.stringify(leads, null, 2));
} finally {
  await prisma.$disconnect();
}
