import prisma from '../src/config/prisma';

async function main() {
  const users = await prisma.user.count();
  const leads = await prisma.lead.count();
  console.log(JSON.stringify({ users, leads }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
