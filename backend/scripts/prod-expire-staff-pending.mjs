import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const sessionId = '97cec163-39d4-4e77-8e43-79169dab9d47';
const result = await prisma.pendingAction.updateMany({
  where: { sessionId, status: 'awaiting' },
  data: { status: 'expired', resolvedAt: new Date() },
});
console.log(JSON.stringify({ expired: result.count }, null, 2));
await prisma.$disconnect();
