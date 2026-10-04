import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PendingSkillReview, SkillBadges, SkillReviewRecordPage, SkillReviewStep } from '@skill-hub/shared';
import type { SkillReviewAction, SkillVersionStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertNotStale,
  findVisibleVersion,
  latestPerVersion,
  RECORDS_NEWEST_FIRST,
  rejectComments,
  type SkillViewer,
  statusChanged,
  toRecordInfo,
  toVersionInfo,
  type VersionWithSkill,
  withRecordRelations,
  withUploader,
} from './skill-views';

/** 审核动作的迁移规则（ADR-0004：状态设在版本上）；approve / reject / publish 的租户管理员身份由控制器的 @TenantAdminOnly 保证 */
interface Transition {
  from: SkillVersionStatus;
  to: SkillVersionStatus;
  action: SkillReviewAction;
  /** 除角色外的权限：不满足时返回拒绝原因 */
  forbidden?: (version: VersionWithSkill, viewer: SkillViewer) => string | null;
}

const ownerOnly = (version: VersionWithSkill, viewer: SkillViewer) =>
  version.skill.ownerEmployeeId === viewer.employeeId ? null : '只有该 Skill 的所有者可以提交或撤回审核';

const TRANSITIONS: Record<SkillReviewStep, Transition> = {
  submit: { from: 'draft', to: 'pending', action: 'submit', forbidden: ownerOnly },
  withdraw: { from: 'pending', to: 'draft', action: 'withdraw', forbidden: ownerOnly },
  approve: { from: 'pending', to: 'published', action: 'approve' },
  reject: { from: 'pending', to: 'draft', action: 'reject' },
  // 租户管理员存的草稿由其本人直接发布；员工的草稿须提交审核
  publish: {
    from: 'draft',
    to: 'published',
    action: 'publish_direct',
    forbidden: (version, viewer) => (version.uploaderEmployeeId === viewer.employeeId ? null : '只有上传该草稿的租户管理员可以直接发布，员工的草稿须提交审核'),
  },
};

/** 审核流程：版本状态迁移与审核记录、待审核列表、全租户审核记录、菜单红点。 */
@Injectable()
export class SkillReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 执行一步审核动作并记录。按「当前状态 = 期望的起始状态」条件更新：两名管理员同时处理同一个版本时只有一个成功，
   * 后到者（或重复操作）得到「状态已变化」。
   */
  async transition(viewer: SkillViewer, actorUserId: string, skillId: string, versionId: string, step: SkillReviewStep, comment = ''): Promise<void> {
    const rule = TRANSITIONS[step];
    const version = await findVisibleVersion(this.prisma, viewer, skillId, versionId);
    const reason = rule.forbidden?.(version, viewer);
    if (reason) throw new ForbiddenException(reason);
    if (version.status !== rule.from) throw statusChanged(version.status);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.skillVersion.updateMany({ where: { id: versionId, status: rule.from }, data: { status: rule.to } });
      await assertNotStale(tx, count, versionId);
      await tx.skillReviewRecord.create({ data: { skillId, versionId, action: rule.action, actorUserId, comment } });
    });
  }

  /** 待审核列表：按（最近一次）提交时间从早到晚。 */
  async pending(tenantId: string): Promise<PendingSkillReview[]> {
    const versions = await this.prisma.skillVersion.findMany({
      where: { status: 'pending', skill: { tenantId } },
      include: { ...withUploader, skill: { include: { versions: { where: { status: 'published' }, select: { id: true }, take: 1 } } } },
    });
    const submits = await this.prisma.skillReviewRecord.findMany({
      where: { versionId: { in: versions.map((v) => v.id) }, action: 'submit' },
      orderBy: RECORDS_NEWEST_FIRST,
    });
    const lastSubmit = latestPerVersion(submits);
    return versions
      .map((v) => ({ v, at: lastSubmit.get(v.id)?.createdAt ?? v.uploadedAt }))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map(({ v, at }) => ({
        skillId: v.skillId,
        skillName: v.skill.name,
        isNewSkill: v.skill.versions.length === 0,
        version: toVersionInfo(v),
        submittedAt: at.toISOString(),
      }));
  }

  /** 全租户审核记录，从新到旧分页。 */
  async records(tenantId: string, page: number, pageSize: number): Promise<SkillReviewRecordPage> {
    const where = { skill: { tenantId } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.skillReviewRecord.findMany({ where, include: withRecordRelations, orderBy: RECORDS_NEWEST_FIRST, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.skillReviewRecord.count({ where }),
    ]);
    return { items: items.map(toRecordInfo), total, page, pageSize };
  }

  /** 菜单红点：租户管理员的待审核数；我是所有者、被驳回且仍是草稿的版本数。 */
  async badges(viewer: SkillViewer): Promise<SkillBadges> {
    const pendingReviews = viewer.isTenantAdmin ? await this.prisma.skillVersion.count({ where: { status: 'pending', skill: { tenantId: viewer.tenantId } } }) : 0;
    const drafts = await this.prisma.skillVersion.findMany({
      where: { status: 'draft', skill: { tenantId: viewer.tenantId, ownerEmployeeId: viewer.employeeId } },
      select: { id: true },
    });
    const rejected = await rejectComments(this.prisma, drafts.map((d) => d.id));
    return { pendingReviews, rejectedDrafts: rejected.size };
  }
}
