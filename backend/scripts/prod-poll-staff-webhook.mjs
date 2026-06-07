import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const BASE = 'https://investo-backend-production.up.railway.app';
const since = new Date();

const msgId = `wamid.manual.staff.${Date.now()}`;
const payload = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'manual-proof',
    changes: [{
      field: 'messages',
      value: {
        metadata: { phone_number_id: '1090528010807708', display_phone_number: '+15551642552' },
        contacts: [{ profile: { name: 'Kiran Sales' } }],
        messages: [{ from: '919036165603', id: msgId, type: 'text', text: { body: 'visits today' } }],
      },
    }],
  }],
};

const res = await fetch(`${BASE}/api/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
console.log('webhook HTTP', res.status);

const staff = await prisma.user.findFirst({
  where: { companyId: 'a9c308d8-1083-4981-bd46-3667e0474e8e', phone: { contains: '9036165603' } },
  select: { id: true, name: true },
});
const session = staff
  ? await prisma.agentSession.findFirst({ where: { userId: staff.id }, orderBy: { updatedAt: 'desc' }, select: { id: true, threadId: true } })
  : null;

for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const rows = session
    ? await prisma.$queryRawUnsafe(
        `SELECT role, LEFT(content,300) AS content, created_at AS at FROM agent_session_messages
         WHERE session_id = $1::uuid AND created_at > $2 ORDER BY created_at DESC LIMIT 4`,
        session.id,
        since,
      )
    : [];
  const logs = await prisma.agentActionLog.findMany({
    where: { companyId: 'a9c308d8-1083-4981-bd46-3667e0474e8e', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { action: true, status: true },
  });
  const dedup = await prisma.inboundWhatsappDedup.findFirst({
    where: { whatsappMessageId: msgId },
    select: { id: true, createdAt: true },
  });
  console.log(`poll ${i + 1}: sessionMsgs=${rows.length} logs=${logs.length} dedup=${!!dedup}`);
  if (rows.length) {
    console.log(JSON.stringify({ rows, logs, dedup }, null, 2));
    break;
  }
}

await prisma.$disconnect();
