import 'dotenv/config';
import { PrismaService } from './prisma/prisma.service';
import { seedDemo } from './seed/demo';
const prisma = new PrismaService();
seedDemo(prisma).then(() => console.log('演示账号和团队已就绪')).catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
