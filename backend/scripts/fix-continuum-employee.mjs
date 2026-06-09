#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8'));
const url = vars.DIRECT_URL || vars.DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const EMAIL = 'thecontinuum.solutions@gmail.com';
const PASSWORD = 'Kiran@2112';
const ROLE = 'sales_agent';
const NAME = 'Employee One';
const PHONE = '+919036165603';

try {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    console.error('User not found:', EMAIL);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await prisma.user.update({
    where: { email: EMAIL },
    data: {
      passwordHash,
      role: ROLE,
      name: NAME,
      phone: PHONE,
      status: 'active',
      mustChangePassword: false,
    },
  });

  const ok = await bcrypt.compare(PASSWORD, passwordHash);
  console.log(JSON.stringify({
    email: EMAIL,
    role: ROLE,
    name: NAME,
    phone: PHONE,
    companyId: user.companyId,
    passwordVerified: ok,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
