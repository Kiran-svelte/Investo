#!/usr/bin/env node
/**
 * One-time migration: copy legacy Railway Meta creds into company.settings.whatsapp.meta
 * so production no longer depends on WHATSAPP_* Railway env vars.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const varsPath = path.join(__dirname, '..', '..', 'scripts', '.railway-prod-vars.json');
const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));

const phoneNumberId = String(vars.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const accessToken = String(vars.WHATSAPP_ACCESS_TOKEN || '').trim();
const verifyToken = String(vars.WHATSAPP_VERIFY_TOKEN || '').trim();
const appSecret = String(vars.WHATSAPP_APP_SECRET || '').trim();
const businessAccountId = String(vars.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();

if (!phoneNumberId || !accessToken || !verifyToken || !appSecret) {
  throw new Error('Missing WHATSAPP_* values in scripts/.railway-prod-vars.json');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

try {
  let company = await prisma.company.findFirst({
    where: { name: { contains: 'Palm', mode: 'insensitive' } },
    select: { id: true, name: true, settings: true, status: true },
  });

  if (!company) {
    company = await prisma.company.findFirst({
      where: {
        status: 'active',
        slug: { not: 'investo-platform' },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, settings: true, status: true, slug: true },
    });
  }

  if (!company) {
    throw new Error('No tenant company found to store Meta credentials (platform company is excluded)');
  }

  if (company.slug === 'investo-platform') {
    throw new Error('Refusing to store Meta credentials on the platform company');
  }

  const currentSettings = (company.settings && typeof company.settings === 'object')
    ? { ...company.settings }
    : {};
  const existingWhatsApp = (currentSettings.whatsapp && typeof currentSettings.whatsapp === 'object')
    ? { ...currentSettings.whatsapp }
    : {};
  const existingMeta = (existingWhatsApp.meta && typeof existingWhatsApp.meta === 'object')
    ? { ...existingWhatsApp.meta }
    : {};

  const metaSettings = {
    ...existingMeta,
    phoneNumberId,
    accessToken,
    verifyToken,
    appSecret,
    businessAccountId: businessAccountId || existingMeta.businessAccountId,
  };

  const whatsappSettings = {
    ...existingWhatsApp,
    provider: 'meta',
    meta: metaSettings,
    phoneNumberId,
    accessToken,
    verifyToken,
    appSecret,
    businessAccountId: metaSettings.businessAccountId,
    verifiedAt: existingWhatsApp.verifiedAt || new Date().toISOString(),
  };

  await prisma.company.update({
    where: { id: company.id },
    data: {
      status: 'active',
      settings: {
        ...currentSettings,
        whatsapp: whatsappSettings,
      },
    },
  });

  console.log(JSON.stringify({
    migrated: true,
    companyId: company.id,
    companyName: company.name,
    phoneNumberId,
    verifyTokenLength: verifyToken.length,
    appSecretLength: appSecret.length,
  }));
} finally {
  await prisma.$disconnect();
}
