import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { SkillFeedbackInfo, SkillFeedbackPendingCount } from '@skill-hub/shared';
import { TenantMember } from '../auth/decorators';
import type { CurrentEmployeeContext } from '../auth/session';
import { CurrentEmployee } from '../auth/decorators';
import { CreateSkillFeedbackDto, SkillFeedbackQueryDto, UpdateSkillFeedbackDto } from './skills.dto';
import { SkillFeedbacksService } from './skill-feedbacks.service';

@TenantMember()
@Controller('skills')
export class SkillFeedbacksController {
  constructor(private readonly feedbacks: SkillFeedbacksService) {}

  @Get(':id/feedbacks')
  list(
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @Query() query: SkillFeedbackQueryDto,
  ): Promise<SkillFeedbackInfo[]> {
    return this.feedbacks.list(employee, id, query.status);
  }

  @Post(':id/feedbacks')
  create(
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @Body() dto: CreateSkillFeedbackDto,
  ): Promise<SkillFeedbackInfo> {
    return this.feedbacks.create(employee, id, dto.title, dto.description, dto.contextVersionId);
  }

  @Patch(':id/feedbacks/:feedbackId')
  update(
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @Param('feedbackId') feedbackId: string,
    @Body() dto: UpdateSkillFeedbackDto,
  ): Promise<SkillFeedbackInfo> {
    return this.feedbacks.update(employee, id, feedbackId, dto.status, dto.resolution);
  }

  @Get(':id/feedbacks/pending-count')
  pendingCount(
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
  ): Promise<SkillFeedbackPendingCount> {
    return this.feedbacks.pendingCount(employee, id);
  }
}
