import {
  type RejectSkillVersionRequest,
  SKILL_CATEGORY_NAME_MAX_LENGTH,
  type SkillCategoryRequest,
  type UpdateSkillCategoryRequest,
  SKILL_REJECT_COMMENT_MAX_LENGTH,
  SKILL_VERSION_FORMAT_MESSAGE,
  SKILL_VERSION_PATTERN,
  type SkillListQuery,
  type SkillManageQuery,
  type SkillUploadMode,
  type SkillVersionStatus,
  type SkillVisibility,
  type SkillVisibilityInput,
  type UploadSkillRequest,
} from '@skill-hub/shared';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

// class-validator 自下而上执行，类型校验放在最靠近属性处（见 tenants.dto.ts）
const trim = Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

const UPLOAD_MODES: SkillUploadMode[] = ['publish', 'draft', 'submit'];
const VISIBILITIES: SkillVisibility[] = ['tenant', 'departments', 'employees', 'private'];

// multipart 表单里重复的字段是数组、单个字段是字符串：统一成数组
const toArray = Transform(({ value }) => (value === undefined || Array.isArray(value) ? value : [value]));
const visibilityIn = IsIn(VISIBILITIES, { message: '可见性不正确' });

/** 特定部门 / 特定员工可见时的名单（上传的 multipart 与修改可见性的 JSON 共用） */
class VisibilityListsDto {
  @toArray
  @IsOptional()
  @IsString({ each: true, message: '所选部门不正确' })
  @IsArray({ message: '所选部门不正确' })
  departmentIds?: string[];

  @toArray
  @IsOptional()
  @IsString({ each: true, message: '所选员工不正确' })
  @IsArray({ message: '所选员工不正确' })
  employeeIds?: string[];
}

export class UploadSkillDto extends VisibilityListsDto implements UploadSkillRequest {
  @trim
  @Matches(SKILL_VERSION_PATTERN, { message: SKILL_VERSION_FORMAT_MESSAGE })
  @IsNotEmpty({ message: '请填写版本号' })
  @IsString({ message: '请填写版本号' })
  version!: string;

  @IsOptional()
  @IsIn(UPLOAD_MODES, { message: '上传去向不正确' })
  mode?: SkillUploadMode;

  // 可见性及名单仅新建 Skill 时生效（缺省租户可见）
  @IsOptional()
  @visibilityIn
  visibility?: SkillVisibility;

  // 分类仅新建 Skill 时生效（可不选；multipart 里空字符串视为不选）
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString({ message: '所选分类不正确' })
  categoryId?: string;
}

export class SkillCategoryDto implements SkillCategoryRequest {
  @trim
  @MaxLength(SKILL_CATEGORY_NAME_MAX_LENGTH, { message: `分类名称不能超过 ${SKILL_CATEGORY_NAME_MAX_LENGTH} 个字` })
  @IsNotEmpty({ message: '请填写分类名称' })
  @IsString({ message: '请填写分类名称' })
  name!: string;
}

export class UpdateSkillCategoryDto implements UpdateSkillCategoryRequest {
  // null 表示清空；缺省视为格式错误
  @ValidateIf((_, value) => value !== null)
  @IsNotEmpty({ message: '所选分类不正确' })
  @IsString({ message: '所选分类不正确' })
  categoryId!: string | null;
}

export class UpdateSkillVisibilityDto extends VisibilityListsDto implements SkillVisibilityInput {
  @visibilityIn
  @IsNotEmpty({ message: '可见性不正确' })
  visibility!: SkillVisibility;
}

export class RejectSkillVersionDto implements RejectSkillVersionRequest {
  @trim
  @MaxLength(SKILL_REJECT_COMMENT_MAX_LENGTH, { message: `驳回意见不能超过 ${SKILL_REJECT_COMMENT_MAX_LENGTH} 字` })
  @IsNotEmpty({ message: '请填写驳回意见' })
  @IsString({ message: '请填写驳回意见' })
  comment!: string;
}

export const SKILL_RECORDS_PAGE_SIZE_MAX = 100;

export class SkillReviewRecordsQueryDto {
  @IsOptional()
  @Min(1, { message: '页码必须为正整数' })
  @IsInt({ message: '页码必须为正整数' })
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Max(SKILL_RECORDS_PAGE_SIZE_MAX, { message: `每页最多 ${SKILL_RECORDS_PAGE_SIZE_MAX} 条` })
  @Min(1, { message: '每页条数必须为正整数' })
  @IsInt({ message: '每页条数必须为正整数' })
  @Type(() => Number)
  pageSize?: number;
}

export class SkillListQueryDto implements SkillListQuery {
  @trim
  @IsOptional()
  @MaxLength(64, { message: '搜索关键词不能超过 64 个字符' })
  @IsString({ message: '搜索关键词不正确' })
  keyword?: string;

  @IsOptional()
  @IsString({ message: '上传人不正确' })
  uploaderId?: string;

  @IsOptional()
  @IsString({ message: '分类不正确' })
  categoryId?: string;
}

const VERSION_STATUSES: SkillVersionStatus[] = ['draft', 'pending', 'published'];

export class SkillManageQueryDto extends SkillListQueryDto implements SkillManageQuery {
  @IsOptional()
  @IsIn(VERSION_STATUSES, { message: '审核状态不正确' })
  status?: SkillVersionStatus;

  @IsOptional()
  @visibilityIn
  visibility?: SkillVisibility;

  @IsOptional()
  @IsIn(['true', 'false'], { message: '是否下架不正确' })
  unlisted?: 'true' | 'false';
}
