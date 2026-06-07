import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const COMPANY = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const since = new Date(Date.now() - 10 * 60 * 1000);

const staff = await prisma.user.findFirst({
  where: { companyId: COMPANY, phone: { contains: '9036165603' } },
  select: { id: true, name: true },
});
const session = staff
  ? await prisma.agentSession.findFirst({ where: { userId: staff.id }, orderBy: { updatedAt: 'desc' }, select: { id: true } })
  : null;
const sessionMsgs = session
  ? await prisma.$queryRawUnsafe(
      `SELECT role, LEFT(content, 200) AS content, created_at AS "at"
       FROM agent_session_messages WHERE session_id = $1::uuid AND created_at > $2
       ORDER BY created_at DESC LIMIT 6`,
      session.id,
      since,
    )
  : [];

const buyerLead = await prisma.lead.findFirst({
  where: { companyId: COMPANY, phone: { contains: '6363062930' } },
  select: { id: true, customerName: true, leadMemory: true, status: true },
});
const buyerMsgs = buyerLead
  ? await prisma.message.findMany({
      where: {
        conversation: { leadId: buyerLead.id },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { senderType: true, content: true, createdAt: true },
    })
  : [];

const logs = await prisma.agentActionLog.findMany({
  where: { companyId: COMPANY, createdAt: { gte: since } },
  orderBy: { createdAt: 'desc' },
  take: 10,
  select: { action: true, status: true, createdAt: true },
});

console.log(JSON.stringify({ staff: staff?.name, sessionMsgs, buyerLead, buyerMsgs, logs }, null, 2));
await prisma.$disconnect();
