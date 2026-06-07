import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const since = new Date('2026-06-07T09:05:00Z');

const rows = await prisma.$queryRawUnsafe(
  `SELECT role, LEFT(content,150) AS content, created_at AS at FROM agent_session_messages
   WHERE session_id = '97cec163-39d4-4e77-8e43-79169dab9d47'::uuid AND created_at > $1 ORDER BY created_at ASC`,
  since,
);
console.log(JSON.stringify(rows, null, 2));
await prisma.$disconnect();
