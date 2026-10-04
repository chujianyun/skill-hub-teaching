import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import type { SkillFilePreview, SkillReviewView } from '@skill-hub/shared';
import { Auth } from '../auth/decorators';
import type { AuthContext } from '../auth/session';
import { SkillReviewLinksService } from './skill-review-links.service';

/**
 * 审核链接（/skills/review/:versionId）用的接口：只要求登录，按身份授权（见 SkillReviewLinksService），
 * 不使用 @TenantMember——打开链接的可能是处在其他租户的管理员或超管。
 */
@Controller('skills/review-links')
export class SkillReviewLinksController {
  constructor(private readonly links: SkillReviewLinksService) {}

  @Get(':versionId')
  view(@Auth() auth: AuthContext, @Param('versionId') versionId: string): Promise<SkillReviewView> {
    return this.links.view(auth, versionId);
  }

  /** 下载审阅（不计入下载次数） */
  @Get(':versionId/download')
  async download(@Auth() auth: AuthContext, @Param('versionId') versionId: string): Promise<StreamableFile> {
    const { fileName, data } = await this.links.download(auth, versionId);
    return new StreamableFile(data, { type: 'application/zip', disposition: `attachment; filename="${fileName}"` });
  }

  /** 预览包内文件：?path=相对 Skill 根目录的路径 */
  @Get(':versionId/file')
  previewFile(@Auth() auth: AuthContext, @Param('versionId') versionId: string, @Query('path') path?: string): Promise<SkillFilePreview> {
    return this.links.previewFile(auth, versionId, typeof path === 'string' ? path : undefined);
  }
}
