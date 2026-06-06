import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const varsPath = path.join(path.resolve(import.meta.dirname, '../..'), 'scripts', '.railway-prod-vars.json');
const raw = fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, '');
const vars = JSON.parse(raw);
const adapter = new PrismaPg({ connectionString: vars.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

try {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, slug: true, settings: true, whatsappPhone: true },
    take: 20,
  });
  console.log('companies', companies.length);
  for (const c of companies) {
    const s = c.settings || {};
    const wa = s.whatsapp || {};
    const meta = wa.meta || wa;
    const pnid = meta.phoneNumberId || meta.phone_number_id || wa.phoneNumberId || '';
    console.log(JSON.stringify({ id: c.id, name: c.name, slug: c.slug, pnid, phone: c.whatsappPhone }));
  }

  const users = await prisma.user.findMany({
    where: { phone: { not: null }, role: { in: ['sales_agent', 'company_admin'] } },
    select: { email: true, role: true, phone: true, companyId: true },
    take: 15,
  });
  console.log('staff_users', JSON.stringify(users, null, 2));
} finally {
  await prisma.$disconnect();
}
