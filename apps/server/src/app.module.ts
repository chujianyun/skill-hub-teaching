import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { SkillsModule } from './skills/skills.module';

@Module({
  imports: [PrismaModule, AuthModule, HealthModule, SkillsModule],
})
export class AppModule {}