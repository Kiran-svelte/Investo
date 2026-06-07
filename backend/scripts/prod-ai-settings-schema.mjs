import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const vars = JSON.parse(
  fs.readFileSync(new URL('../../scripts/.railway-prod-vars.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''),
);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const cols = await prisma.$queryRawUnsafe(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_settings' ORDER BY ordinal_position`,
);
const names = cols.map((c) => c.column_name);
console.log('ai_settings columns:', names.join(', '));
console.log('missing auto_confirm_visits:', !names.includes('auto_confirm_visits'));
console.log('missing agent_name:', !names.includes('agent_name'));

try {
  const row = await prisma.aiSetting.findUnique({
    where: { companyId: 'a9c308d8-1083-4981-bd46-3667e0474e8e' },
  });
  console.log('findUnique OK:', Boolean(row));
} catch (err) {
  console.log('findUnique FAIL:', err instanceof Error ? err.message : String(err));
}

await prisma.$disconnect();
