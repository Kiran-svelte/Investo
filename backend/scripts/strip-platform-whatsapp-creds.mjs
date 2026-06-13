#!/usr/bin/env node
/**
 * Strip legacy Meta creds from the platform company shell and remove stray buyer leads.
 */
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
  const platform = await prisma.company.findFirst({
    where: { slug: 'investo-platform' },
    select: { id: true, name: true, settings: true },
  });

  if (!platform) {
    console.log(JSON.stringify({ ok: false, reason: 'platform_company_missing' }));
    process.exit(1);
  }

  const settings = (platform.settings && typeof platform.settings === 'object')
    ? { ...platform.settings }
    : {};

  if (settings.whatsapp) {
    delete settings.whatsapp;
  }

  await prisma.company.update({
    where: { id: platform.id },
    data: { settings },
  });

  const deleted = await prisma.lead.deleteMany({ where: { companyId: platform.id } });

  console.log(JSON.stringify({
    ok: true,
    platformCompanyId: platform.id,
    strippedWhatsappSettings: true,
    deletedLeads: deleted.count,
  }));
} finally {
  await prisma.$disconnect();
}
