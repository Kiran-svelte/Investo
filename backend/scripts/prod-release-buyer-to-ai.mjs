import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const LEAD_PHONE = '6363062930';
const COMPANY = 'a9c308d8-1083-4981-bd46-3667e0474e8e';

const lead = await prisma.lead.findFirst({
  where: { companyId: COMPANY, phone: { contains: LEAD_PHONE } },
  select: { id: true, customerName: true, phone: true, status: true },
});
const conv = lead
  ? await prisma.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { updatedAt: 'desc' } })
  : null;

if (conv && (!conv.aiEnabled || conv.status !== 'ai_active')) {
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { aiEnabled: true, status: 'ai_active', stage: 'qualify', escalationReason: null, escalatedAt: null },
  });
  console.log('Released buyer to AI');
} else {
  console.log('Buyer already ai_active');
}

await prisma.$disconnect();
