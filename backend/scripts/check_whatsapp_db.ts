
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('--- Checking Database for WhatsApp Config ---');
  
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      settings: true,
    }
  });

  console.log(`Found ${companies.length} companies:`);
  companies.forEach(c => {
    const settings = c.settings as any;
    const whatsapp = settings?.whatsapp || {};
    const meta = whatsapp.meta || whatsapp;
    
    console.log(`- Company: ${c.name} (ID: ${c.id})`);
    console.log(`  Status: ${c.status}`);
    console.log(`  WhatsApp Provider: ${whatsapp.provider || 'meta'}`);
    console.log(`  Meta Phone Number ID: ${meta.phoneNumberId || meta.phone_number_id || 'NOT SET'}`);
    console.log(`  Meta Access Token: ${meta.accessToken ? 'SET (Length: ' + meta.accessToken.length + ')' : 'NOT SET'}`);
  });

  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  console.log('\n--- Recent Leads ---');
  leads.forEach(l => {
    console.log(`- Lead: ${l.customerName || 'No Name'} (${l.phone}) - Created: ${l.createdAt}`);
  });

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
