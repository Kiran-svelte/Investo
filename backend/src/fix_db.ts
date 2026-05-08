import { PrismaClient } from '@prisma/client';

process.env.DATABASE_URL = "postgresql://neondb_owner:npg_RNC6gJvOn1Yp@ep-hidden-sea-a5f97918-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient();

async function main() {
  const companyId = '082b8e66-76af-4fed-9a69-db8d615893ed';
  const CORRECT_PHONE_NUMBER_ID = '1090528010807708';
  const NEW_PERMANENT_TOKEN = 'EAATgQyqKPScBRQYYIPdPHLTasVizp8HLKgWp9xpy38I8yjxz3YqpyrC95b8ZCt5IfvVjG66Hg1LwsRosMZAYgTItCcgSZCv6SWYOxTkgMRZBpWqIqZBjO4ZA2ZAs1PIiVhp8CyXd3gGSeSU1KY0QJSWe3hgoZAuGZC3DfLI5VOAj7IauSME4USsyKiV9MPJsFxoA3GQZDZD';

  console.log(`Searching for company ${companyId}...`);
  const company = await prisma.company.findUnique({
    where: { id: companyId }
  });

  if (!company) {
    console.error('Company not found!');
    return;
  }

  console.log(`Found company: ${company.name}. Updating settings...`);
  const currentSettings = (company.settings as any) || {};
  const updatedSettings = {
    ...currentSettings,
    whatsapp: {
      ...(currentSettings.whatsapp || {}),
      provider: 'meta',
      meta: {
        ...(currentSettings.whatsapp?.meta || {}),
        phoneNumberId: CORRECT_PHONE_NUMBER_ID,
        accessToken: NEW_PERMANENT_TOKEN,
        verifyToken: 'abc-investo'
      },
      // Mirror for legacy code
      phoneNumberId: CORRECT_PHONE_NUMBER_ID,
      accessToken: NEW_PERMANENT_TOKEN,
      verifyToken: 'abc-investo'
    }
  };

  await prisma.company.update({
    where: { id: companyId },
    data: { settings: updatedSettings as any }
  });

  console.log('Database updated successfully!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
