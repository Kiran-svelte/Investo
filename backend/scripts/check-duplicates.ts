/**
 * Pre-migration check: verify no duplicate (companyId, phone) pairs in leads table
 * before adding unique constraint.
 * Run: npx ts-node scripts/check-duplicates.ts
 */
import prisma from '../src/config/prisma';

async function checkDuplicates(): Promise<void> {
  const duplicates = await prisma.$queryRaw<Array<{ company_id: string; phone: string; cnt: bigint }>>`
    SELECT company_id, phone, COUNT(*) as cnt 
    FROM leads 
    GROUP BY company_id, phone 
    HAVING COUNT(*) > 1 
    LIMIT 10
  `;

  if (duplicates.length === 0) {
    console.log('✅ No duplicate (companyId, phone) pairs found. Safe to add unique constraint.');
  } else {
    console.log('❌ Duplicate leads found — must resolve before migration:');
    duplicates.forEach((d) => {
      console.log(`  companyId: ${d.company_id}, phone: ${d.phone}, count: ${d.cnt}`);
    });
  }

  const dupMessages = await prisma.$queryRaw<Array<{ whatsapp_message_id: string; cnt: bigint }>>`
    SELECT whatsapp_message_id, COUNT(*) as cnt 
    FROM messages 
    WHERE whatsapp_message_id IS NOT NULL 
    GROUP BY whatsapp_message_id 
    HAVING COUNT(*) > 1 
    LIMIT 10
  `;

  if (dupMessages.length === 0) {
    console.log('✅ No duplicate whatsappMessageId found. Safe to add unique constraint.');
  } else {
    console.log('❌ Duplicate message IDs found — must resolve before migration:');
    dupMessages.forEach((d) => {
      console.log(`  whatsappMessageId: ${d.whatsapp_message_id}, count: ${d.cnt}`);
    });
  }

  await prisma.$disconnect();
}

checkDuplicates().catch((err: unknown) => {
  console.error('Check failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
