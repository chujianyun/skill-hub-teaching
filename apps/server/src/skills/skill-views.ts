import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  SKILL_VERSION_STATUS_LABELS,
  type SkillReviewRecordInfo,
  type SkillVersionInfo,
  type SkillVersionStatus,
  type SkillWorkingVersion,
} from '@skill-hub/shared';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { canSeeSkill } from './skill-visibility';

/** Skill 与版本的查询形状、DTO 转换与非正式版本的访问规则；可见性规则见 skill-visibility.ts。 */

export const notFound = () => new NotFoundException('Skill 不存在');

/** 当前员工（取自会话）：判断所有者与管理员身份 */
export interface SkillViewer {
  tenantId: string;
  employeeId: string;
  isTenantAdmin: boolean;
}

/** 所有者与租户管理员可以看到非正式版本、审核记录（spec 002） */
export const canManage = (viewer: SkillViewer, skill: { ownerEmployeeId: string }) => viewer.isTenantAdmin || skill.ownerEmployeeId === viewer.employeeId;

export const BY_VERSION_DESC = [{ major: 'desc' }, { minor: 'desc' }, { patch: 'desc' }] satisfies Prisma.SkillVersionOrderByWithRelationInput[];

export const withUploader = { uploader: { include: { user: true } } } satisfies Prisma.SkillVersionInclude;
export type VersionRow = Prisma.SkillVersionGetPayload<{ include: typeof withUploader }>;

export const toVersionInfo = (v: VersionRow): SkillVersionInfo => ({
  id: v.id,
  version: v.version,
  description: v.description,
  uploaderName: v.uploader.user.name,
  uploadedAt: v.uploadedAt.toISOString(),
  sizeBytes: v.sizeBytes,
  fileCount: v.fileCount,
  downloadCount: v.downloadCount,
});

export const withRecordRelations = { actor: true, version: true, skill: true } satisfies Prisma.SkillReviewRecordInclude;
type RecordRow = Prisma.SkillReviewRecordGetPayload<{ include: typeof withRecordRelations }>;

export const toRecordInfo = (r: RecordRow): SkillReviewRecordInfo => ({
  id: r.id,
  skillId: r.skillId,
  skillName: r.skill.name,
  versionId: r.versionId,
  version: r.version?.version ?? null,
  action: r.action,
  actorName: r.actor.name,
  comment: r.comment,
  createdAt: r.createdAt.toISOString(),
});

/** 审核记录从新到旧；同一时刻的记录按 id 排序，保证顺序稳定 */
export const RECORDS_NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.SkillReviewRecordOrderByWithRelationInput[];

/** 每个版本最新的一条记录（records 须已按从新到旧排序） */
export function latestPerVersion<T extends { versionId: string | null }>(records: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const r of records) if (r.versionId && !latest.has(r.versionId)) latest.set(r.versionId, r);
  return latest;
}

/**
 * 被驳回退回、尚未再次提交的草稿：草稿最近一次审核结论（不计「重新上传」）是「驳回」时，返回该记录的意见。
 * 返回 versionId → 驳回意见；不在其中的版本表示不是被驳回的。
 */
export async function rejectComments(prisma: PrismaService, draftIds: string[]): Promise<Map<string, string>> {
  if (draftIds.length === 0) return new Map();
  const records = await prisma.skillReviewRecord.findMany({
    where: { versionId: { in: draftIds }, action: { not: 'reupload' } },
    orderBy: RECORDS_NEWEST_FIRST,
  });
  return new Map([...latestPerVersion(records)].filter(([, r]) => r.action === 'reject').map(([id, r]) => [id, r.comment]));
}

export function toWorkingVersion(v: VersionRow, comments: Map<string, string>, viewerEmployeeId: string | null): SkillWorkingVersion {
  return {
    ...toVersionInfo(v),
    status: v.status as SkillWorkingVersion['status'],
    rejectComment: v.status === 'draft' ? (comments.get(v.id) ?? null) : null,
    uploadedByMe: v.uploaderEmployeeId === viewerEmployeeId,
  };
}

export const versionWithSkill = { ...withUploader, skill: true } satisfies Prisma.SkillVersionInclude;
export type VersionWithSkill = Prisma.SkillVersionGetPayload<{ include: typeof versionWithSkill }>;

/**
 * 按查看者取版本：所有者与租户管理员能看所有版本；其他员工只能看可见性命中的 Skill 的正式版本，其余一律 404。
 */
export async function findVisibleVersion(prisma: PrismaService, viewer: SkillViewer, skillId: string, versionId: string): Promise<VersionWithSkill> {
  const version = await prisma.skillVersion.findFirst({ where: { id: versionId, skillId, skill: { tenantId: viewer.tenantId } }, include: versionWithSkill });
  if (!version) throw notFound();
  if (!canManage(viewer, version.skill) && (version.status !== 'published' || !(await canSeeSkill(prisma, viewer, skillId)))) throw notFound();
  return version;
}

/** 状态迁移时版本已不在预期状态（并发处理或重复操作） */
export const statusChanged = (status: SkillVersionStatus) =>
  new ConflictException(`该版本状态已变化（当前：${SKILL_VERSION_STATUS_LABELS[status]}），可能已被他人处理，请刷新后查看`);

/** 按「当前状态 = 期望状态」条件更新或删除后调用：没有命中任何行说明状态已被并发改变，按当前状态返回 409。 */
export async function assertNotStale(client: Pick<Prisma.TransactionClient, 'skillVersion'>, count: number, versionId: string): Promise<void> {
  if (count === 0) throw statusChanged((await client.skillVersion.findUniqueOrThrow({ where: { id: versionId } })).status);
}
