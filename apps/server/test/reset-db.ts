import { PrismaService } from '../src/prisma/prisma.service';
import { seedDemo } from '../src/seed/demo';
import { resetDatabase } from './reset-database';
import { TEST_DATABASE_URL } from './test-database';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL;
const prisma = new PrismaService();
resetDatabase(prisma).then(() => seedDemo(prisma)).catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
