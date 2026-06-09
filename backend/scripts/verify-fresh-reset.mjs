#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: databaseUrl }) });

const EMAIL = 'big.investo.sol@gmail.com';
const PASSWORD = 'Investo@321';

try {
  const [companies, users, leads, props, convos, aiSettings, tokens] = await Promise.all([
    prisma.company.count(),
    prisma.user.count(),
    prisma.lead.count(),
    prisma.property.count(),
    prisma.conversation.count(),
    prisma.aiSetting.count(),
    prisma.refreshToken.count(),
  ]);

  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  const passwordOk = user ? await bcrypt.compare(PASSWORD, user.passwordHash) : false;

  console.log(JSON.stringify({
    counts: { companies, users, leads, props, convos, aiSettings, tokens },
    superAdmin: user ? { email: user.email, role: user.role, status: user.status, passwordOk } : null,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
