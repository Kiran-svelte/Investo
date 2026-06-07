import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const PALM_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const NEW_PHONE = process.env.PALM_WHATSAPP_PHONE || '+15551642552';
const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const before = await prisma.company.findUnique({ where: { id: PALM_ID }, select: { whatsappPhone: true } });
if (before?.whatsappPhone === NEW_PHONE) {
  console.log('Already set:', NEW_PHONE);
} else {
  await prisma.company.update({ where: { id: PALM_ID }, data: { whatsappPhone: NEW_PHONE } });
  console.log(`Updated Palm whatsappPhone: ${before?.whatsappPhone} -> ${NEW_PHONE}`);
}
await prisma.$disconnect();
