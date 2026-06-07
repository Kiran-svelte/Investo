import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

try {
  const companies = await prisma.company.findMany({ select: { name: true, settings: true } });
  for (const c of companies) {
    const settings = c.settings && typeof c.settings === 'object' ? c.settings : {};
    const w = settings.whatsapp || {};
  const meta = w.meta || {};
  console.log(c.name, { appId: w.appId, metaKeys: w.meta ? Object.keys(w.meta).join(',') : 'none', appSecretLen: w.meta?.appSecret ? String(w.meta.appSecret).length : 0 });
  }
} finally {
  await prisma.$disconnect();
}
