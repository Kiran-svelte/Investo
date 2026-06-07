import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const lead = await prisma.lead.findFirst({
  where: { companyId: 'a9c308d8-1083-4981-bd46-3667e0474e8e', phone: { contains: '6363062930' } },
});
const conv = lead
  ? await prisma.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { updatedAt: 'desc' } })
  : null;
const msgs = conv
  ? await prisma.message.findMany({
      where: { conversationId: conv.id, createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) } },
      orderBy: { createdAt: 'asc' },
      select: { senderType: true, content: true, createdAt: true, whatsappMessageId: true },
    })
  : [];

for (const m of msgs) {
  console.log(`${m.createdAt.toISOString()} [${m.senderType}] ${m.content.slice(0, 100).replace(/\n/g, ' ')}`);
}
await prisma.$disconnect();
