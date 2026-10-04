import { PrismaService } from '../src/prisma/prisma.service';

/** 清空业务表（保留迁移记录），每个用例从干净状态开始。 */
export async function resetDatabase(prisma: PrismaService) {
  const dbName = new URL(process.env.DATABASE_URL!).pathname;
  if (!dbName.endsWith('_test')) throw new Error('Refusing to reset a non-test database');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
