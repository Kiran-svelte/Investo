import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const mins = Number(process.argv[2] || 3);
const since = new Date(Date.now() - mins * 60 * 1000);
const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const COMPANY = 'a9c308d8-1083-4981-bd46-3667e0474e8e';

const staff = await prisma.user.findFirst({
  where: { companyId: COMPANY, phone: { contains: '9036165603' } },
  select: { id: true, name: true },
});
const session = staff ? await prisma.agentSession.findFirst({ where: { userId: staff.id }, orderBy: { updatedAt: 'desc' } }) : null;
const staffMsgs = session
  ? await prisma.$queryRawUnsafe(
      `SELECT role, content, created_at AS at FROM agent_session_messages
       WHERE session_id = $1::uuid AND created_at > $2 ORDER BY created_at DESC LIMIT 8`,
      session.id,
      since,
    )
  : [];

const buyer = await prisma.lead.findFirst({
  where: { companyId: COMPANY, customerName: { contains: 'Kannada', mode: 'insensitive' } },
  select: { id: true, customerName: true, phone: true, leadMemory: true, status: true },
});
const conv = buyer
  ? await prisma.conversation.findFirst({ where: { leadId: buyer.id }, orderBy: { updatedAt: 'desc' }, select: { status: true, aiEnabled: true, stage: true } })
  : null;
const buyerMsgs = buyer
  ? await prisma.message.findMany({
      where: { conversation: { leadId: buyer.id }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { senderType: true, content: true, createdAt: true },
    })
  : [];
const visits = buyer
  ? await prisma.visit.count({ where: { leadId: buyer.id, status: { not: 'cancelled' } } })
  : 0;
const logs = await prisma.agentActionLog.findMany({
  where: { companyId: COMPANY, createdAt: { gte: since } },
  orderBy: { createdAt: 'desc' },
  take: 12,
  select: { action: true, status: true, createdAt: true },
});

console.log(JSON.stringify({ since, staff: staff?.name, staffMsgs, buyer: { ...buyer, conv, visits }, buyerMsgs, logs }, null, 2));
await prisma.$disconnect();
