import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const since = new Date(Date.now() - 15 * 60 * 1000);

const dedups = await prisma.inboundWhatsappDedup.findMany({
  where: { companyId: 'a9c308d8-1083-4981-bd46-3667e0474e8e', createdAt: { gte: since } },
  orderBy: { createdAt: 'desc' },
  take: 15,
  select: { whatsappMessageId: true, senderPhone: true, createdAt: true },
});

const staff = await prisma.user.findFirst({
  where: { phone: { contains: '9036165603' } },
  select: { id: true, name: true },
});
const session = staff
  ? await prisma.agentSession.findFirst({ where: { userId: staff.id }, orderBy: { updatedAt: 'desc' } })
  : null;
const staffMsgs = session
  ? await prisma.$queryRawUnsafe(
      `SELECT role, LEFT(content,120) AS content, created_at AS at FROM agent_session_messages
       WHERE session_id = $1::uuid AND created_at > $2 ORDER BY created_at DESC LIMIT 10`,
      session.id,
      since,
    )
  : [];

console.log(JSON.stringify({ dedups, sessionId: session?.id, staffMsgs }, null, 2));
await prisma.$disconnect();
