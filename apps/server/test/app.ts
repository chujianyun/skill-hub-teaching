import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export async function createTestApp(): Promise<{ app: NestExpressApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  // 测试文件内只监听一次：否则 Supertest 会为每个请求临时 listen(0)/close，端口被复用时偶发连接错乱（ECONNRESET / Parse Error）
  await app.listen(0, '127.0.0.1');
  return { app, prisma: app.get(PrismaService) };
}
