import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tryDeterministicAgentCrmReply } from '../src/services/agent/agent-crm-query.service.ts';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const staff = await prisma.user.findFirst({
  where: { phone: { contains: '9036165603' } },
  include: { company: { select: { name: true } } },
});
const session = await prisma.agentSession.findFirst({ where: { userId: staff.id }, orderBy: { updatedAt: 'desc' } });
const ctx = {
  userId: staff.id,
  companyId: staff.companyId,
  userRole: staff.role,
  userName: staff.name,
  sessionId: session?.id,
  staffPhone: staff.phone,
  companyName: staff.company?.name || 'Palm',
};
for (const msg of ['visits today', 'new leads today', 'help']) {
  const reply = await tryDeterministicAgentCrmReply(ctx, msg, {});
  console.log(msg, '=>', reply?.slice(0, 120) || null);
}
await prisma.$disconnect();
