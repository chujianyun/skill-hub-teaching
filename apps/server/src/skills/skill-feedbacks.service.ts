import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FEEDBACK_STATUS_LABELS, type FeedbackStatus, type SkillFeedbackInfo } from '@skill-hub/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canManage, notFound, type SkillViewer } from './skill-views';
import { canSeeSkill, canViewSkill } from './skill-visibility';

const VALID_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  pending: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: [],
};

const withRelations = {
  submitterEmployee: { include: { user: true } },
  resolverEmployee: { include: { user: true } },
  contextVersion: true,
  skill: true,
};

type FeedbackRow = Prisma.SkillFeedbackGetPayload<{ include: typeof withRelations }>;

function toFeedbackInfo(f: FeedbackRow): SkillFeedbackInfo {
  return {
    id: f.id,
    skillId: f.skillId,
    title: f.title,
    description: f.description,
    status: f.status,
    submitterName: f.submitterEmployee.user.name,
    contextVersion: f.contextVersion?.version ?? null,
    resolverName: f.resolverEmployee?.user.name ?? null,
    resolution: f.resolution,
    createdAt: f.createdAt.toISOString(),
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class SkillFeedbacksService {
  constructor(private readonly prisma: PrismaService) {}

  private async findSkillForFeedback(prisma: PrismaService, viewer: SkillViewer, skillId: string) {
    const skill = await prisma.skill.findFirst({ where: { id: skillId, tenantId: viewer.tenantId } });
    if (!skill) throw notFound();
    return skill;
  }

  private async assertCanSeeSkill(viewer: SkillViewer, skill: { id: string; ownerEmployeeId: string }) {
    if (canManage(viewer, skill)) return;
    if (!(await canViewSkill(this.prisma, viewer, skill))) throw notFound();
  }

  async list(viewer: SkillViewer, skillId: string, status?: FeedbackStatus): Promise<SkillFeedbackInfo[]> {
    const skill = await this.findSkillForFeedback(this.prisma, viewer, skillId);
    await this.assertCanSeeSkill(viewer, skill);

    const where: Prisma.SkillFeedbackWhereInput = { skillId };
    if (status) where.status = status;

    const feedbacks = await this.prisma.skillFeedback.findMany({
      where,
      include: withRelations,
      orderBy: { createdAt: 'desc' },
    });
    return feedbacks.map(toFeedbackInfo);
  }

  async create(viewer: SkillViewer, skillId: string, title: string, description: string, contextVersionId?: string) {
    const skill = await this.findSkillForFeedback(this.prisma, viewer, skillId);
    await this.assertCanSeeSkill(viewer, skill);

    if (contextVersionId) {
      const version = await this.prisma.skillVersion.findFirst({
        where: { id: contextVersionId, skillId, status: 'published' },
      });
      if (!version) throw new BadRequestException('所选版本不存在');
    }

    const feedback = await this.prisma.skillFeedback.create({
      data: {
        skillId,
        title,
        description,
        submitterEmployeeId: viewer.employeeId,
        contextVersionId,
      },
      include: withRelations,
    });
    return toFeedbackInfo(feedback);
  }

  async update(viewer: SkillViewer, skillId: string, feedbackId: string, newStatus: FeedbackStatus, resolution?: string) {
    const skill = await this.findSkillForFeedback(this.prisma, viewer, skillId);
    if (!canManage(viewer, skill)) {
      if (await canSeeSkill(this.prisma, viewer, skillId)) {
        throw new ForbiddenException('只有 Skill 作者或租户管理员可以管理反馈');
      }
      throw notFound();
    }

    const feedback = await this.prisma.skillFeedback.findFirst({ where: { id: feedbackId, skillId } });
    if (!feedback) throw new NotFoundException('反馈不存在');

    const allowed = VALID_TRANSITIONS[feedback.status];
    if (!allowed.includes(newStatus)) {
      throw new ConflictException(
        `无法从「${FEEDBACK_STATUS_LABELS[feedback.status]}」转为「${FEEDBACK_STATUS_LABELS[newStatus]}」`,
      );
    }

    if (newStatus === 'resolved' && !resolution?.trim()) {
      throw new BadRequestException('标记已解决时必须填写处理说明');
    }

    const { count } = await this.prisma.skillFeedback.updateMany({
      where: { id: feedbackId, status: feedback.status },
      data: {
        status: newStatus,
        resolverEmployeeId: newStatus === 'resolved' ? viewer.employeeId : feedback.resolverEmployeeId,
        resolution: newStatus === 'resolved' ? resolution : feedback.resolution,
        resolvedAt: newStatus === 'resolved' ? new Date() : feedback.resolvedAt,
      },
    });

    if (count === 0) {
      const current = await this.prisma.skillFeedback.findUniqueOrThrow({ where: { id: feedbackId } });
      throw new ConflictException(
        `该反馈状态已变化（当前：${FEEDBACK_STATUS_LABELS[current.status]}），请刷新后查看`,
      );
    }

    const updated = await this.prisma.skillFeedback.findUniqueOrThrow({
      where: { id: feedbackId },
      include: withRelations,
    });
    return toFeedbackInfo(updated);
  }

  async pendingCount(viewer: SkillViewer, skillId: string): Promise<{ count: number }> {
    const skill = await this.findSkillForFeedback(this.prisma, viewer, skillId);
    if (!canManage(viewer, skill)) {
      if (await canSeeSkill(this.prisma, viewer, skillId)) {
        throw new ForbiddenException('只有 Skill 作者或租户管理员可以查看待处理数量');
      }
      throw notFound();
    }

    const count = await this.prisma.skillFeedback.count({
      where: { skillId, status: 'pending' },
    });
    return { count };
  }
}
