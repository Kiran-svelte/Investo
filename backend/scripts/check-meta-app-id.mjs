import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

try {
  const palm = await prisma.company.findFirst({
    where: { name: { contains: 'Palm', mode: 'insensitive' } },
    select: { settings: true },
  });
  const w = palm?.settings?.whatsapp || {};
  const meta = w.meta || w;
  console.log('appId:', meta.appId || w.appId || 'none');
  console.log('wabaId:', meta.wabaId || w.businessAccountId || 'none');

  const token = meta.accessToken || vars.WHATSAPP_ACCESS_TOKEN;
  if (meta.appId && token) {
    const url = `https://graph.facebook.com/v18.0/${meta.appId}?fields=id,name&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    console.log('graph app lookup:', res.status, (await res.text()).slice(0, 200));
  }
} finally {
  await prisma.$disconnect();
}
