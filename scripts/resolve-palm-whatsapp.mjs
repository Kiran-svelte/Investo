import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');
const raw = fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, '');
const vars = JSON.parse(raw);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const company = await prisma.company.findUnique({
  where: { id: 'a9c308d8-1083-4981-bd46-3667e0474e8e' },
  select: { name: true, whatsappPhone: true, metaPhoneNumberId: true },
});
console.log(JSON.stringify(company, null, 2));
await prisma.$disconnect();
