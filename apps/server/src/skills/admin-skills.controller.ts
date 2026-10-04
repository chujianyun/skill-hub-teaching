import { Controller, Delete, Get, HttpCode, Param, Post, Query, StreamableFile } from '@nestjs/common';
import type { SkillDetail, SkillManageRow } from '@skill-hub/shared';
import { Auth, SuperAdminOnly } from '../auth/decorators';
import type { AuthContext } from '../auth/session';
import { SkillManageQueryDto } from './skills.dto';
import { SkillsService } from './skills.service';

/**
 * 超管的 Skill 治理（spec 001「超管不参与租户内部管理」的唯一例外）：按租户查看、下载任意版本、下架 / 上架、删除。
 * 不提供上传与审核；查看版本文件复用审核链接页（超管只读）。
 */
@SuperAdminOnly()
@Controller('admin')
export class AdminSkillsController {
  @Get('tenants')
  listTenants() { return this.skills.demoTenants(); }
  constructor(private readonly skills: SkillsService) {}

  @Get('tenants/:tenantId/skills')
  list(@Param('tenantId') tenantId: string, @Query() query: SkillManageQueryDto): Promise<SkillManageRow[]> {
    return this.skills.adminList(tenantId, query);
  }

  @Get('skills/:id')
  get(@Param('id') id: string): Promise<SkillDetail> {
    return this.skills.adminGet(id);
  }

  /** 下载任意版本（不计入下载次数） */
  @Get('skills/:id/versions/:versionId/download')
  async download(@Param('id') id: string, @Param('versionId') versionId: string): Promise<StreamableFile> {
    const { fileName, data } = await this.skills.adminDownload(id, versionId);
    return new StreamableFile(data, { type: 'application/zip', disposition: `attachment; filename="${fileName}"` });
  }

  @Post('skills/:id/unlist')
  @HttpCode(204)
  unlist(@Auth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    return this.skills.adminSetUnlisted(auth.user.id, id, true);
  }

  @Post('skills/:id/relist')
  @HttpCode(204)
  relist(@Auth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    return this.skills.adminSetUnlisted(auth.user.id, id, false);
  }

  @Delete('skills/:id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.skills.adminDeleteSkill(id);
  }
}
