import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
process.env.DATABASE_URL = vars.DATABASE_URL;

const { tryDeterministicAgentCrmReply } = await import('../src/services/agent/agent-crm-query.service.ts');

const staff = { userId: '7c850cb4-e04a-4819-b84a-1127a5c158c1', companyId: 'a9c308d8-1083-4981-bd46-3667e0474e8e', userRole: 'sales_agent', userName: 'Kiran Sales', sessionId: '97cec163-39d4-4e77-8e43-79169dab9d47', staffPhone: '+919036165603', companyName: 'Palm' };

for (const msg of ['visits today', 'new leads today', 'help']) {
  const reply = await tryDeterministicAgentCrmReply(staff, msg, {});
  console.log('\n---', msg, '---\n', reply?.slice(0, 200) || '(null)');
}
