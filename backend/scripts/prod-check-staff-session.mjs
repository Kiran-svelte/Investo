import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const staff = await prisma.user.findFirst({
  where: { phone: { contains: '9036165603' } },
  select: { id: true, name: true, phone: true },
});
const sessions = await prisma.agentSession.findMany({
  where: { userId: staff?.id },
  select: { id: true, threadId: true, phone: true, status: true, lastActiveAt: true },
  orderBy: { lastActiveAt: 'desc' },
});
const allMsgs = sessions.length
  ? await prisma.$queryRawUnsafe(
      `SELECT role, LEFT(content,100) AS content, created_at AS at FROM agent_session_messages
       WHERE session_id = $1::uuid ORDER BY created_at DESC LIMIT 15`,
      sessions[0].id,
    )
  : [];

console.log(JSON.stringify({ staff, sessions, allMsgs }, null, 2));
await prisma.$disconnect();
