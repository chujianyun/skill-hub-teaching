import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { PendingSkillReview, SkillBadges, SkillReviewRecordPage } from '@skill-hub/shared';
import { Auth, CurrentEmployee, TenantAdminOnly, TenantMember } from '../auth/decorators';
import type { AuthContext, CurrentEmployeeContext } from '../auth/session';
import { SkillReviewsService } from './skill-reviews.service';
import { RejectSkillVersionDto, SkillReviewRecordsQueryDto } from './skills.dto';

/**
 * Skill 审核流程。路径与 SkillsController 同在 /api/skills 下：本控制器须先于 SkillsController 注册，
 * 使 reviews、badges 这些固定路径先于 :id 匹配（见 skills.module.ts）。
 */
@TenantMember()
@Controller('skills')
export class SkillReviewsController {
  constructor(private readonly reviews: SkillReviewsService) {}

  /** 待审核列表 */
  @Get('reviews')
  @TenantAdminOnly()
  pending(@CurrentEmployee() employee: CurrentEmployeeContext): Promise<PendingSkillReview[]> {
    return this.reviews.pending(employee.tenantId);
  }

  /** 全租户审核记录 */
  @Get('reviews/records')
  @TenantAdminOnly()
  records(@CurrentEmployee() employee: CurrentEmployeeContext, @Query() query: SkillReviewRecordsQueryDto): Promise<SkillReviewRecordPage> {
    return this.reviews.records(employee.tenantId, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get('badges')
  badges(@CurrentEmployee() employee: CurrentEmployeeContext): Promise<SkillBadges> {
    return this.reviews.badges(employee);
  }

  @Post(':id/versions/:versionId/submit')
  @HttpCode(204)
  submit(@Auth() auth: AuthContext, @CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    return this.reviews.transition(employee, auth.user.id, id, versionId, 'submit');
  }

  @Post(':id/versions/:versionId/withdraw')
  @HttpCode(204)
  withdraw(@Auth() auth: AuthContext, @CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    return this.reviews.transition(employee, auth.user.id, id, versionId, 'withdraw');
  }

  @Post(':id/versions/:versionId/approve')
  @HttpCode(204)
  @TenantAdminOnly()
  approve(@Auth() auth: AuthContext, @CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    return this.reviews.transition(employee, auth.user.id, id, versionId, 'approve');
  }

  @Post(':id/versions/:versionId/reject')
  @HttpCode(204)
  @TenantAdminOnly()
  reject(
    @Auth() auth: AuthContext,
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() dto: RejectSkillVersionDto,
  ) {
    return this.reviews.transition(employee, auth.user.id, id, versionId, 'reject', dto.comment);
  }

  /** 租户管理员直接发布自己存的草稿 */
  @Post(':id/versions/:versionId/publish')
  @HttpCode(204)
  @TenantAdminOnly()
  publish(@Auth() auth: AuthContext, @CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    return this.reviews.transition(employee, auth.user.id, id, versionId, 'publish');
  }
}
