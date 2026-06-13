#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const varsPath = path.join(__dirname, '..', '..', 'scripts', '.railway-prod-vars.json');
const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

try {
  const companies = await prisma.company.findMany({
    where: { status: 'active' },
    select: { id: true, name: true, settings: true },
  });

  for (const company of companies) {
    const settings = company.settings || {};
    const wa = settings.whatsapp || {};
    const meta = wa.meta || wa;
    console.log(JSON.stringify({
      id: company.id,
      name: company.name,
      hasPhone: Boolean(meta.phoneNumberId || meta.phone_number_id || wa.phoneNumberId),
      hasToken: Boolean(meta.accessToken || wa.accessToken),
      hasVerify: Boolean(meta.verifyToken || wa.verifyToken),
      hasSecret: Boolean(meta.appSecret || meta.app_secret || wa.appSecret),
    }));
  }
} finally {
  await prisma.$disconnect();
}
