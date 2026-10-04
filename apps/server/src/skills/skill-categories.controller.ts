import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { SkillCategoryItem } from '@skill-hub/shared';
import { CurrentEmployee, TenantAdminOnly, TenantMember } from '../auth/decorators';
import type { CurrentEmployeeContext } from '../auth/session';
import { SkillCategoryDto } from './skills.dto';
import { SkillCategoriesService } from './skill-categories.service';

/** 当前租户的 Skill 分类（#20）：所有成员可读（选择、筛选用），只有租户管理员可以增删改。 */
@TenantMember()
@Controller('skills/categories')
export class SkillCategoriesController {
  constructor(private readonly categories: SkillCategoriesService) {}

  /** 租户管理员额外返回每个分类的 Skill 数 */
  @Get()
  list(@CurrentEmployee() employee: CurrentEmployeeContext): Promise<SkillCategoryItem[]> {
    return this.categories.list(employee.tenantId, employee.isTenantAdmin);
  }

  @Post()
  @TenantAdminOnly()
  create(@CurrentEmployee() employee: CurrentEmployeeContext, @Body() dto: SkillCategoryDto): Promise<SkillCategoryItem[]> {
    return this.categories.create(employee.tenantId, dto.name);
  }

  /** 一键添加常用分类（只补上还没有的） */
  @Post('presets')
  @TenantAdminOnly()
  addPresets(@CurrentEmployee() employee: CurrentEmployeeContext): Promise<SkillCategoryItem[]> {
    return this.categories.addPresets(employee.tenantId);
  }

  @Patch(':id')
  @TenantAdminOnly()
  rename(@CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string, @Body() dto: SkillCategoryDto): Promise<SkillCategoryItem[]> {
    return this.categories.rename(employee.tenantId, id, dto.name);
  }

  /** 删除分类：使用它的 Skill 变为未分类 */
  @Delete(':id')
  @HttpCode(204)
  @TenantAdminOnly()
  remove(@CurrentEmployee() employee: CurrentEmployeeContext, @Param('id') id: string): Promise<void> {
    return this.categories.remove(employee.tenantId, id);
  }
}
