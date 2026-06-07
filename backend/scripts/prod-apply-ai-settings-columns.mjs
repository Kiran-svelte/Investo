import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(
  fs.readFileSync(new URL('../../scripts/.railway-prod-vars.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''),
);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const sql = `
ALTER TABLE "ai_settings"
  ADD COLUMN IF NOT EXISTS "auto_confirm_visits" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_settings"
  ADD COLUMN IF NOT EXISTS "agent_name" VARCHAR(50) NOT NULL DEFAULT 'Riya';
`;

await prisma.$executeRawUnsafe(sql);
console.log('Applied ai_settings column migration');

const cols = await prisma.$queryRawUnsafe(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name IN ('auto_confirm_visits','agent_name')`,
);
console.log('Verified columns:', cols);

const row = await prisma.aiSetting.findUnique({
  where: { companyId: 'a9c308d8-1083-4981-bd46-3667e0474e8e' },
  select: { id: true, autoConfirmVisits: true, agentName: true },
});
console.log('findUnique OK:', row);

await prisma.$disconnect();
