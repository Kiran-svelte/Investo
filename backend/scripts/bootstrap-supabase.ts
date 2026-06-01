import { bootstrapDatabase } from '../src/config/bootstrapDatabase';
import prisma from '../src/config/prisma';

async function main() {
  await bootstrapDatabase({ autoMigrate: false, autoSeed: false });
  await prisma.$disconnect();
  console.log('Bootstrap patches applied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
