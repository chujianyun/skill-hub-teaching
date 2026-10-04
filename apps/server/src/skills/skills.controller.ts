import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { type MySkill, type SkillDetail, type SkillManageRow, type SkillSummary, type SkillVisibilityOptions } from '@skill-hub/shared';
import { Auth, CurrentEmployee, TenantAdminOnly, TenantMember } from '../auth/decorators';
import type { AuthContext, CurrentEmployeeContext } from '../auth/session';
import { SkillListQueryDto, SkillManageQueryDto, UpdateSkillCategoryDto, UpdateSkillVisibilityDto, UploadSkillDto } from './skills.dto';
import { requireFile, SkillUploadInterceptor } from './skill-upload';
import { SkillsService, type SkillActor } from './skills.service';

const actorOf = (auth: AuthContext, employee: CurrentEmployeeContext): SkillActor => ({ ...employee, userId: auth.user.id });

/** 当前租户的 Skill；tenantId 只取自会话。审核相关接口见 SkillReviewsController，审核链接见 SkillReviewLinksController。 */
@TenantMember()
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  /** 目录：可按名称 / 描述搜索、按上传人与分类筛选 */
  @Get()
  list(@CurrentEmployee() employee: CurrentEmployeeContext, @Query() query: SkillListQueryDto): Promise<SkillSummary[]> {
    return this.skills.list(employee, query);
  }

  /** 管理视图（租户管理员）：本租户全部 Skill，可按审核状态、可见性、是否下架、分类（含未分类）筛选（须在 :id 之前声明） */
  @Get('manage')
  @TenantAdminOnly()
  manage(@CurrentEmployee() employee: CurrentEmployeeContext, @Query() query: SkillManageQueryDto): Promise<SkillManageRow[]> {
    return this.skills.manageList(employee.tenantId, query);
  }

  /** 选择可见范围用的部门树与在职员工（须在 :id 之前声明） */
  @Get('visibility-options')
  visibilityOptions(@CurrentEmployee() employee: CurrentEmployeeContext): Promise<SkillVisibilityOptions> {
    return this.skills.visibilityOptions(employee.tenantId);
  }

  /** 我是所有者的 Skill（须在 :id 之前声明） */
  @Get('mine')
  mine(@CurrentEmployee() employee: CurrentEmployeeContext): Promise<MySkill[]> {
    return this.skills.mine(employee);
  }

  @Get(':id')
  get(@CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string): Promise<SkillDetail> {
    return this.skills.get(employee, id);
  }

  /** 新建 Skill：multipart 字段 file 为 zip（浏览器选择文件夹后打包），version 为版本号，mode 为上传去向。 */
  @Post()
  @UseInterceptors(SkillUploadInterceptor)
  create(
    @Auth() auth: AuthContext,
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadSkillDto,
  ): Promise<SkillDetail> {
    return this.skills.create(actorOf(auth, employee), requireFile(file), dto.version, dto.mode, dto.visibility ? { ...dto, visibility: dto.visibility } : undefined, dto.categoryId);
  }

  /** 修改可见性（所有者或租户管理员）：立即生效，不需要审核 */
  @Patch(':id/visibility')
  updateVisibility(
    @Auth() auth: AuthContext,
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @Body() dto: UpdateSkillVisibilityDto,
  ): Promise<SkillDetail> {
    return this.skills.updateVisibility(actorOf(auth, employee), id, dto);
  }

  /** 修改分类（所有者或租户管理员）：立即生效，不需要审核；categoryId 为 null 表示清空 */
  @Patch(':id/category')
  updateCategory(
    @Auth() auth: AuthContext,
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @Body() dto: UpdateSkillCategoryDto,
  ): Promise<SkillDetail> {
    return this.skills.updateCategory(actorOf(auth, employee), id, dto.categoryId);
  }

  /** 为已有 Skill 上传新版本：multipart 同上；只有所有者和租户管理员可以上传。 */
  @Post(':id/versions')
  @UseInterceptors(SkillUploadInterceptor)
  createVersion(
    @Auth() auth: AuthContext,
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadSkillDto,
  ): Promise<SkillDetail> {
    return this.skills.createVersion(actorOf(auth, employee), id, requireFile(file), dto.version, dto.mode);
  }

  /** 重新上传草稿的包（被驳回后修改），版本号不变 */
  @Put(':id/versions/:versionId/package')
  @UseInterceptors(SkillUploadInterceptor)
  replaceDraftPackage(
    @Auth() auth: AuthContext,
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SkillDetail> {
    return this.skills.replaceDraftPackage(actorOf(auth, employee), id, versionId, requireFile(file));
  }

  /** 删除单个版本：租户管理员可删除任意版本，其他人只能删除自己的草稿 */
  @Delete(':id/versions/:versionId')
  @HttpCode(204)
  deleteVersion(@CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string, @Param('versionId') versionId: string): Promise<void> {
    return this.skills.deleteVersion(employee, id, versionId);
  }

  /** 删除整个 Skill（所有者或租户管理员） */
  @Delete(':id')
  @HttpCode(204)
  deleteSkill(@CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string): Promise<void> {
    return this.skills.deleteSkill(employee, id);
  }

  @Post(':id/unlist')
  @HttpCode(204)
  @TenantAdminOnly()
  unlist(@Auth() auth: AuthContext, @CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string): Promise<void> {
    return this.skills.setUnlisted(auth.user.id, employee.tenantId, id, true);
  }

  @Post(':id/relist')
  @HttpCode(204)
  @TenantAdminOnly()
  relist(@Auth() auth: AuthContext, @CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string): Promise<void> {
    return this.skills.setUnlisted(auth.user.id, employee.tenantId, id, false);
  }

  @Get(':id/versions/:versionId/download')
  async download(
    @CurrentEmployee() employee: CurrentEmployeeContext,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ): Promise<StreamableFile> {
    const { fileName, data } = await this.skills.download(employee, id, versionId);
    return new StreamableFile(data, { type: 'application/zip', disposition: `attachment; filename="${fileName}"` });
  }
}
