import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

try {
  const dedup = await prisma.inboundWhatsappDedup.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { whatsappMessageId: true, senderPhone: true, createdAt: true },
  });
  console.log('dedup', JSON.stringify(dedup, null, 2));

  const msgs = await prisma.message.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { content: true, senderType: true, createdAt: true, conversation: { select: { leadId: true } } },
  });
  console.log('messages', JSON.stringify(msgs, null, 2));
} catch (e) {
  console.error(e.message);
} finally {
  await prisma.$disconnect();
}
