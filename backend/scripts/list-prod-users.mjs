#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8'));
const url = vars.DIRECT_URL || vars.DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

try {
  const users = await prisma.user.findMany({
    select: { email: true, role: true, status: true, name: true, companyId: true, mustChangePassword: true },
    orderBy: { createdAt: 'asc' },
  });
  const companies = await prisma.company.findMany({ select: { id: true, name: true, slug: true } });
  console.log(JSON.stringify({ users, companies }, null, 2));
} finally {
  await prisma.$disconnect();
}
