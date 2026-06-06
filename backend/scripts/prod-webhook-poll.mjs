import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const BASE = 'https://investo-backend-production.up.railway.app';
const buyerFrom = '91900000' + String(Math.floor(6000 + Math.random() * 3999));
const phone10 = buyerFrom.slice(-10);

async function send() {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'poll',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '1090528010807708' },
          contacts: [{ profile: { name: 'Poll Buyer' } }],
          messages: [{ from: buyerFrom, id: `wamid.poll.${Date.now()}`, type: 'text', text: { body: 'Hello brochure please' } }],
        },
      }],
    }],
  };
  const res = await fetch(`${BASE}/api/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  console.log('webhook', res.status, 'buyer', buyerFrom, 'last10', phone10);
}

try {
  await send();
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const lead = await prisma.lead.findFirst({
      where: { OR: [{ phone: { contains: phone10 } }, { phone: `+${buyerFrom}` }] },
      select: { id: true, phone: true, createdAt: true },
    });
    console.log(`t=${(i + 1) * 5}s lead=${lead ? lead.phone : 'none'}`);
    if (lead) break;
  }
} finally {
  await prisma.$disconnect();
}
