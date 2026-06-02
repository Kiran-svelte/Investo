import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Run bootstrap patches against configured DATABASE_URL in backend/.env
process.chdir(new URL('../backend', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));

const { register: registerTsNode } = await import('ts-node');
registerTsNode({ transpileOnly: true, esm: true });

const { bootstrapDatabase } = await import('../backend/src/config/bootstrapDatabase.ts');
const prisma = (await import('../backend/src/config/prisma.ts')).default;

await bootstrapDatabase({ autoMigrate: false, autoSeed: false });
await prisma.$disconnect();
console.log('Bootstrap complete');
