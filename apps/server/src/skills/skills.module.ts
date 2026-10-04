import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AdminSkillsController } from './admin-skills.controller';
import { SkillCategoriesController } from './skill-categories.controller';
import { SkillCategoriesService } from './skill-categories.service';
import { SkillReviewLinksController } from './skill-review-links.controller';
import { SkillReviewLinksService } from './skill-review-links.service';
import { SkillReviewsController } from './skill-reviews.controller';
import { SkillReviewsService } from './skill-reviews.service';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

@Module({
  imports: [StorageModule],
  // 固定路径的控制器在前：reviews、badges、review-links、categories 须先于 SkillsController 的 :id 匹配
  controllers: [SkillReviewLinksController, SkillReviewsController, SkillCategoriesController, SkillsController, AdminSkillsController],
  providers: [SkillsService, SkillReviewsService, SkillReviewLinksService, SkillCategoriesService],
})
export class SkillsModule {}