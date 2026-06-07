import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const COMPANY_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';

const staff = await prisma.user.findMany({
  where: { companyId: COMPANY_ID, status: 'active' },
  select: { name: true, phone: true, role: true, email: true },
});
const leads = await prisma.lead.findMany({
  where: { companyId: COMPANY_ID, customerName: { contains: 'Kannada', mode: 'insensitive' } },
  take: 5,
  orderBy: { updatedAt: 'desc' },
  select: { id: true, customerName: true, phone: true, status: true, updatedAt: true },
});
const company = await prisma.company.findUnique({
  where: { id: COMPANY_ID },
  select: { whatsappPhone: true, name: true },
});

console.log(JSON.stringify({ company, staff, leads }, null, 2));
await prisma.$disconnect();
