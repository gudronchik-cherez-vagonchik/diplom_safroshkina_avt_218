import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  const user = await prisma.user.upsert({
    where: { email: 'alex@dataisland.local' },
    update: {},
    create: {
      name: 'Alex Chen',
      email: 'alex@dataisland.local',
      passwordHash,
      role: UserRole.OWNER,
    },
  });

  await prisma.project.upsert({
    where: { id: 'seed_project' },
    update: {},
    create: {
      id: 'seed_project',
      name: 'Main Project',
      description: 'Seed project',
      members: {
        create: [{ userId: user.id, role: UserRole.OWNER }],
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
