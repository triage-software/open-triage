// Bootstrap a platform admin: usage `node dist/scripts/create-platform-admin.js <email> <password>`
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('usage: create-platform-admin <email> <password>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.platformAdmin.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });
  console.log(`platform admin ready: ${email}`);
  await prisma.$disconnect();
}

void main();
