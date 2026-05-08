import prisma from '../src/config/prisma';
import { whatsappService } from '../src/services/whatsapp.service';

async function run() {
  // Find first active company
  const company = await prisma.company.findFirst({ where: { status: 'active' } });
  if (!company) {
    console.error('No active company found');
    return;
  }

  // Clear all other companies
  const companies = await prisma.company.findMany();
  for (const c of companies) {
    if (c.id !== company.id) {
      const s = c.settings as any || {};
      if (s?.whatsapp?.greenapi?.idInstance) {
        s.whatsapp.greenapi.idInstance = 'dummy_123';
        await prisma.company.update({ where: { id: c.id }, data: { settings: s } });
      }
    }
  }
  const settings = company.settings as any || {};
  settings.whatsapp = {
    provider: 'greenapi',
    greenapi: {
      idInstance: '7107584520',
      apiTokenInstance: 'dummy_token',
      webhookUrlToken: 'Kiran@2112'
    }
  };
  await prisma.company.update({
    where: { id: company.id },
    data: { settings }
  });

  console.log('Company updated with GreenAPI credentials');

  // Trigger incoming message
  console.log('Simulating incoming WhatsApp message...');
  const result = await whatsappService.handleIncomingMessage({
    provider: 'greenapi',
    phoneNumberId: '7107584520',
    customerPhone: '+919036165603',
    customerName: 'Test User',
    messageText: 'Hello, I want to know more about your properties',
    messageId: 'test-msg-1'
  });

  console.log('Processing Result:', JSON.stringify(result, null, 2));
}

run().catch(console.error).finally(() => prisma.$disconnect());
