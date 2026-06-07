import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const COMPANY = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const since = new Date('2026-06-07T09:41:00Z');

const staffMsgs = await prisma.$queryRawUnsafe(
  `SELECT role, content, created_at AS at FROM agent_session_messages
   WHERE session_id = '97cec163-39d4-4e77-8e43-79169dab9d47'::uuid AND created_at > $1 ORDER BY created_at ASC`,
  since,
);

const lead = await prisma.lead.findFirst({ where: { companyId: COMPANY, phone: { contains: '6363062930' } }, select: { id: true } });
const buyerMsgs = lead
  ? await prisma.message.findMany({
      where: { conversation: { leadId: lead.id }, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { senderType: true, content: true, createdAt: true },
    })
  : [];

console.log(JSON.stringify({ staffMsgs, buyerMsgs }, null, 2));
await prisma.$disconnect();
