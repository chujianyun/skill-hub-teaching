import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  compareSkillVersions,
  type MySkill,
  parseSkillVersion,
  SKILL_UNCATEGORIZED,
  SKILL_VERSION_STATUS_LABELS,
  type SkillCategory,
  type SkillDetail,
  type SkillListQuery,
  type SkillManageQuery,
  type SkillManageRow,
  type SkillNameConflictBody,
  type SkillSummary,
  type SkillUploadMode,
  type SkillVisibilityInput,
  type SkillVisibilityOptions,
  describeSkillVisibility,
} from '@skill-hub/shared';
import { Prisma, type SkillReviewAction, type SkillVersionStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrivateFileStorage } from '../storage/private-file-storage';
import { findTenantCategory } from './skill-categories.service';
import { packSkill, readSkillPackage, type SkillPackage } from './skill-package';
import { assertCanManage, canSeeSkill, canViewSkill, resolveVisibility, toVisibilityInfo, visibleSkillWhere, withVisibility, writeVisibility } from './skill-visibility';
import {
  assertNotStale,
  BY_VERSION_DESC,
  canManage,
  findVisibleVersion,
  notFound,
  RECORDS_NEWEST_FIRST,
  rejectComments,
  type SkillViewer,
  toRecordInfo,
  toVersionInfo,
  toWorkingVersion,
  type VersionRow,
  withRecordRelations,
  withUploader,
} from './skill-views';

const isPrismaError = (err: unknown, code: string) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
const versionNotHigher = (highest: string) => new BadRequestException(`版本号必须大于已有的最高版本 ${highest}`);
const draftOwnerOnly = () => new ForbiddenException('只有该 Skill 的所有者或这个草稿的上传人可以修改或删除它');

// 目录与版本历史：只含正式版本，按版本号从新到旧；第一个即当前版本
const publishedVersions = { where: { status: 'published' }, orderBy: BY_VERSION_DESC, include: withUploader } satisfies Prisma.Skill$versionsArgs;
const allVersions = { orderBy: BY_VERSION_DESC, include: withUploader } satisfies Prisma.Skill$versionsArgs;
const detailInclude = { versions: allVersions, owner: { include: { user: true } }, category: true, ...withVisibility } satisfies Prisma.SkillInclude;
const toCategory = (c: { id: string; name: string } | null): SkillCategory | null => (c ? { id: c.id, name: c.name } : null);
type DetailRow = Prisma.SkillGetPayload<{ include: typeof detailInclude }>;

/**
 * 搜索：名称或版本描述包含 keyword（不区分大小写）；上传人：上传过其中某个版本；分类：等于所选分类（或未分类）。
 * 目录只看正式版本（publishedOnly），管理视图看全部版本。
 */
function searchWhere(query: SkillListQuery, publishedOnly: boolean): Prisma.SkillWhereInput[] {
  const scope: Prisma.SkillVersionWhereInput = publishedOnly ? { status: 'published' } : {};
  const where: Prisma.SkillWhereInput[] = [];
  if (query.keyword) {
    where.push({
      OR: [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { versions: { some: { ...scope, description: { contains: query.keyword, mode: 'insensitive' } } } },
      ],
    });
  }
  if (query.uploaderId) where.push({ versions: { some: { ...scope, uploaderEmployeeId: query.uploaderId } } });
  // 分类：SKILL_UNCATEGORIZED 表示未分类
  if (query.categoryId) where.push({ categoryId: query.categoryId === SKILL_UNCATEGORIZED ? null : query.categoryId });
  return where;
}

/** 管理视图（租户管理员、超管）的筛选：在搜索之外，按审核状态（有该状态的版本）、可见性、是否下架 */
function manageWhere(query: SkillManageQuery): Prisma.SkillWhereInput[] {
  const where = searchWhere(query, false);
  if (query.status) where.push({ versions: { some: { status: query.status } } });
  if (query.visibility) where.push({ visibility: query.visibility });
  if (query.unlisted) where.push({ unlisted: query.unlisted === 'true' });
  return where;
}

/** 操作人：员工档案（含当时是否租户管理员）+ User（审核记录的操作人记 User） */
export interface SkillActor extends SkillViewer {
  userId: string;
}

/**
 * 上传去向 → 版本初始状态与审核记录（spec 002：由上传那一刻的身份决定）。
 * 租户管理员：直接发布（默认，记 publish_direct）或存草稿；其他员工：提交审核（默认，记 submit）或存草稿。
 */
/** 版本的初始状态，及随之记下的审核动作（存草稿不记） */
interface InitialState {
  status: SkillVersionStatus;
  action?: SkillReviewAction;
}

function initialState(mode: SkillUploadMode | undefined, isTenantAdmin: boolean): InitialState {
  const resolved = mode ?? (isTenantAdmin ? 'publish' : 'submit');
  if (resolved === 'draft') return { status: 'draft' };
  if (isTenantAdmin) {
    if (resolved === 'submit') throw new BadRequestException('租户管理员上传可选直接发布或存草稿');
    return { status: 'published', action: 'publish_direct' };
  }
  if (resolved === 'publish') throw new ForbiddenException('只有租户管理员可以直接发布，其他人上传须提交审核');
  return { status: 'pending', action: 'submit' };
}

/**
 * 租户内的 Skill。所有查询都带会话中的 tenantId（ADR-0002），其他租户的 Skill 一律视为不存在（404）。
 * 非正式版本（草稿、审核中）只有所有者与租户管理员能看到；还没有正式版本的 Skill 对其他员工完全不可见。
 */
@Injectable()
export class SkillsService {
  demoTenants() { return this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } }); }
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateFileStorage,
  ) {}

  /**
   * 目录：当前员工能看到的、有正式版本的 Skill，按名称排序；可按名称 / 描述搜索、按上传人筛选。
   * 描述只按列表上显示的当前版本匹配（数据库先按任一正式版本粗筛）。
   */
  async list(viewer: SkillViewer, query: SkillListQuery = {}): Promise<SkillSummary[]> {
    const skills = await this.prisma.skill.findMany({
      where: { tenantId: viewer.tenantId, versions: { some: { status: 'published' } }, AND: [await visibleSkillWhere(this.prisma, viewer), ...searchWhere(query, true)] },
      include: { versions: { ...publishedVersions, take: 1 }, category: true },
      orderBy: { name: 'asc' },
    });
    const keyword = query.keyword?.toLowerCase();
    return skills
      .filter((s) => !keyword || s.name.toLowerCase().includes(keyword) || s.versions[0].description.toLowerCase().includes(keyword))
      .map((s) => ({ id: s.id, name: s.name, category: toCategory(s.category), currentVersion: toVersionInfo(s.versions[0]) }));
  }

  async get(viewer: SkillViewer, id: string): Promise<SkillDetail> {
    const skill = await this.prisma.skill.findFirst({ where: { id, tenantId: viewer.tenantId }, include: detailInclude });
    if (!skill) throw notFound();
    const manage = canManage(viewer, skill);
    if (!manage && !(skill.versions.some((v) => v.status === 'published') && (await canSeeSkill(this.prisma, viewer, id)))) throw notFound();
    return this.toDetail(skill, viewer.employeeId, manage);
  }

  /** 管理视图（租户管理员、超管）：本租户全部 Skill，含还没有正式版本、已下架的，按名称排序。 */
  async manageList(tenantId: string, query: SkillManageQuery = {}): Promise<SkillManageRow[]> {
    const skills = await this.prisma.skill.findMany({
      where: { tenantId, AND: manageWhere(query) },
      include: { versions: allVersions, owner: { include: { user: true } }, category: true },
      orderBy: { name: 'asc' },
    });
    return skills.map((s) => {
      const current = s.versions.find((v) => v.status === 'published');
      const working = s.versions.find((v) => v.status !== 'published');
      return {
        id: s.id,
        name: s.name,
        ownerName: s.owner.user.name,
        currentVersion: current ? toVersionInfo(current) : null,
        workingStatus: working ? (working.status as 'draft' | 'pending') : null,
        visibility: s.visibility,
        category: toCategory(s.category),
        unlisted: s.unlisted,
        updatedAt: s.updatedAt.toISOString(),
      };
    });
  }

  /** 超管：按租户查看全部 Skill（租户不存在 404） */
  async adminList(tenantId: string, query: SkillManageQuery = {}): Promise<SkillManageRow[]> {
    if (!(await this.prisma.tenant.findUnique({ where: { id: tenantId } }))) throw new NotFoundException('租户不存在');
    return this.manageList(tenantId, query);
  }

  /** 超管：任意租户的 Skill 详情（只读，含非正式版本与审核记录） */
  async adminGet(id: string): Promise<SkillDetail> {
    const skill = await this.prisma.skill.findUnique({ where: { id }, include: detailInclude });
    if (!skill) throw notFound();
    return this.toDetail(skill, null, true);
  }

  /** 详情；manage（所有者、租户管理员、超管）时带上进行中的版本与审核记录 */
  private async toDetail(skill: DetailRow, viewerEmployeeId: string | null, manage: boolean): Promise<SkillDetail> {
    const published = skill.versions.filter((v) => v.status === 'published');
    const working = manage ? skill.versions.find((v) => v.status !== 'published') : undefined;
    const comments = await rejectComments(this.prisma, working ? [working.id] : []);
    const records = manage
      ? await this.prisma.skillReviewRecord.findMany({ where: { skillId: skill.id }, include: withRecordRelations, orderBy: RECORDS_NEWEST_FIRST })
      : [];
    return {
      id: skill.id,
      name: skill.name,
      category: toCategory(skill.category),
      ownerName: skill.owner.user.name,
      ownerEmployeeId: skill.ownerEmployeeId,
      isOwner: skill.ownerEmployeeId === viewerEmployeeId,
      currentVersion: published[0] ? toVersionInfo(published[0]) : null,
      versions: published.map(toVersionInfo),
      highestVersion: skill.versions[0].version,
      workingVersion: working ? toWorkingVersion(working, comments, viewerEmployeeId) : null,
      reviewRecords: records.map(toRecordInfo),
      visibility: toVisibilityInfo(skill),
      unlisted: skill.unlisted,
    };
  }

  /** 我是所有者的 Skill（含还没有正式版本的），按名称排序。 */
  async mine(viewer: SkillViewer): Promise<MySkill[]> {
    const skills = await this.prisma.skill.findMany({
      where: { tenantId: viewer.tenantId, ownerEmployeeId: viewer.employeeId },
      include: { versions: allVersions },
      orderBy: { name: 'asc' },
    });
    const working = skills.map((s) => s.versions.find((v) => v.status !== 'published')).filter((v): v is VersionRow => !!v);
    const comments = await rejectComments(this.prisma, working.map((v) => v.id));
    const skillIds = skills.map((s) => s.id);
    const pendingCounts = await this.prisma.skillFeedback.groupBy({
      by: ['skillId'],
      where: { skillId: { in: skillIds }, status: 'pending' },
      _count: { id: true },
    });
    const countMap = new Map(pendingCounts.map((c) => [c.skillId, c._count.id]));
    return skills.map((s) => {
      const current = s.versions.find((v) => v.status === 'published');
      const draft = s.versions.find((v) => v.status !== 'published');
      return {
        id: s.id,
        name: s.name,
        currentVersion: current ? toVersionInfo(current) : null,
        workingVersion: draft ? toWorkingVersion(draft, comments, viewer.employeeId) : null,
        pendingFeedbackCount: countMap.get(s.id) ?? 0,
      };
    });
  }

  /** 新建 Skill（本租户任一员工），可同时设置可见性（缺省租户可见）与分类（可不选）；名称已存在时返回 409 并带上已有 Skill 的 id。 */
  async create(
    uploader: SkillActor,
    zip: Buffer,
    version: string,
    mode?: SkillUploadMode,
    visibility?: SkillVisibilityInput,
    categoryId?: string,
  ): Promise<SkillDetail> {
    const state = initialState(mode, uploader.isTenantAdmin);
    const resolved = await resolveVisibility(this.prisma, uploader.tenantId, uploader.employeeId, visibility ?? { visibility: 'tenant' });
    if (categoryId) await findTenantCategory(this.prisma, uploader.tenantId, categoryId);
    const pkg = readSkillPackage(zip);
    await this.assertNameFree(uploader, pkg.name);
    const skillId = await this.withStoredPackage(pkg, async (storageKey) => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const skill = await tx.skill.create({ data: { tenantId: uploader.tenantId, name: pkg.name, ownerEmployeeId: uploader.employeeId, categoryId } });
          await writeVisibility(tx, skill.id, resolved);
          await insertVersion(tx, skill.id, pkg, version, storageKey, uploader, state);
          return skill.id;
        });
      } catch (err) {
        // 并发创建同名 Skill：唯一约束兜底
        if (isPrismaError(err, 'P2002')) await this.assertNameFree(uploader, pkg.name);
        throw err;
      }
    });
    return this.get(uploader, skillId);
  }

  /**
   * 为已有 Skill 上传新版本：只有所有者和租户管理员可以上传；同一个 Skill 同时最多一个非正式版本；
   * SKILL.md 的 name 必须与 Skill 一致；版本号必须严格大于已有的最高版本。锁住 Skill 行后再检查并写入，并发上传串行化。
   */
  async createVersion(uploader: SkillActor, skillId: string, zip: Buffer, version: string, mode?: SkillUploadMode): Promise<SkillDetail> {
    const skill = await this.prisma.skill.findFirst({
      where: { id: skillId, tenantId: uploader.tenantId },
      include: { versions: { where: { status: 'published' }, take: 1 } },
    });
    if (!skill) throw notFound();
    await assertCanManage(this.prisma, uploader, skill, '只有该 Skill 的所有者和租户管理员可以上传新版本');
    const state = initialState(mode, uploader.isTenantAdmin);
    const pkg = readSkillPackage(zip);
    assertSameName(pkg, skill.name);
    await this.withStoredPackage(pkg, (storageKey) =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Skill" WHERE id = ${skillId} FOR UPDATE`;
        const working = await tx.skillVersion.findFirst({ where: { skillId, status: { not: 'published' } } });
        if (working) {
          throw new ConflictException(`该 Skill 已有未成为正式的版本 ${working.version}（${SKILL_VERSION_STATUS_LABELS[working.status]}），请先处理后再上传新版本`);
        }
        const highest = await tx.skillVersion.findFirst({ where: { skillId }, orderBy: BY_VERSION_DESC });
        if (highest && compareSkillVersions(parseSkillVersion(version)!, highest) <= 0) throw versionNotHigher(highest.version);
        await insertVersion(tx, skillId, pkg, version, storageKey, uploader, state);
      }),
    );
    return this.get(uploader, skillId);
  }

  /** 修改可见性（所有者或租户管理员）：不需要审核，立即生效，记一条「修改可见性」（描述修改前后）。 */
  async updateVisibility(actor: SkillActor, skillId: string, input: SkillVisibilityInput): Promise<SkillDetail> {
    const skill = await this.prisma.skill.findFirst({ where: { id: skillId, tenantId: actor.tenantId }, include: withVisibility });
    if (!skill) throw notFound();
    await assertCanManage(this.prisma, actor, skill, '只有该 Skill 的所有者和租户管理员可以修改可见性');
    const resolved = await resolveVisibility(this.prisma, actor.tenantId, skill.ownerEmployeeId, input);
    const before = describeSkillVisibility(toVisibilityInfo(skill));
    await this.prisma.$transaction(async (tx) => {
      await writeVisibility(tx, skillId, resolved);
      const after = await tx.skill.findUniqueOrThrow({ where: { id: skillId }, include: withVisibility });
      await tx.skillReviewRecord.create({
        data: { skillId, action: 'change_visibility', actorUserId: actor.userId, comment: `${before} → ${describeSkillVisibility(toVisibilityInfo(after))}` },
      });
    });
    return this.get(actor, skillId);
  }

  /**
   * 修改分类（所有者或租户管理员，#20）：categoryId 为 null 表示清空；不需要审核，立即生效，记一条「修改分类」（描述修改前后）。
   * 与当前分类相同时不记录。
   */
  async updateCategory(actor: SkillActor, skillId: string, categoryId: string | null): Promise<SkillDetail> {
    const skill = await this.prisma.skill.findFirst({ where: { id: skillId, tenantId: actor.tenantId }, include: { category: true } });
    if (!skill) throw notFound();
    await assertCanManage(this.prisma, actor, skill, '只有该 Skill 的所有者和租户管理员可以修改分类');
    const next = categoryId ? await findTenantCategory(this.prisma, actor.tenantId, categoryId) : null;
    if ((next?.id ?? null) !== skill.categoryId) {
      await this.prisma.$transaction([
        this.prisma.skill.update({ where: { id: skillId }, data: { categoryId: next?.id ?? null } }),
        this.prisma.skillReviewRecord.create({
          data: { skillId, action: 'change_category', actorUserId: actor.userId, comment: `${skill.category?.name ?? '未分类'} → ${next?.name ?? '未分类'}` },
        }),
      ]);
    }
    return this.get(actor, skillId);
  }

  /** 选择可见范围用的本租户部门与在职员工 */
  async visibilityOptions(tenantId: string): Promise<SkillVisibilityOptions> {
    const [departments, employees] = await Promise.all([
      this.prisma.department.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true, parentId: true, name: true } }),
      this.prisma.employee.findMany({ where: { tenantId, status: 'active' }, include: { user: true, department: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { departments, employees: employees.map((e) => ({ id: e.id, name: e.user.name, departmentName: e.department.name })) };
  }

  /** 修改草稿：用新上传的包替换草稿的内容（版本号不变），用于被驳回后修改再提交；记一条「重新上传」。旧包文件随后删除。 */
  async replaceDraftPackage(uploader: SkillActor, skillId: string, versionId: string, zip: Buffer): Promise<SkillDetail> {
    const draft = await this.findOwnDraft(uploader, skillId, versionId, '只有草稿可以重新上传，审核中的版本请先撤回', '正式版本不能修改');
    const pkg = readSkillPackage(zip);
    assertSameName(pkg, draft.skill.name);
    await this.withStoredPackage(pkg, (storageKey) =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await tx.skillVersion.updateMany({
          where: { id: versionId, status: 'draft' },
          data: {
            storageKey,
            description: pkg.description,
            sizeBytes: pkg.sizeBytes,
            fileCount: pkg.fileCount,
            uploadedAt: new Date(),
            uploaderEmployeeId: uploader.employeeId,
          },
        });
        await assertNotStale(tx, count, versionId);
        await tx.skillReviewRecord.create({ data: { skillId, versionId, action: 'reupload', actorUserId: uploader.userId } });
      }),
    );
    await this.storage.delete(draft.storageKey);
    return this.get(uploader, skillId);
  }

  /**
   * 删除单个版本：租户管理员可删除任意版本；其他人只能删除自己的草稿（所有者或该草稿的上传人）。
   * 该版本的审核记录保留（versionId 置空）；删掉的是唯一的版本时，Skill 一并删除。
   */
  async deleteVersion(viewer: SkillViewer, skillId: string, versionId: string): Promise<void> {
    const version = viewer.isTenantAdmin
      ? await findVisibleVersion(this.prisma, viewer, skillId, versionId)
      : await this.findOwnDraft(viewer, skillId, versionId, '审核中的版本请先撤回再删除', '正式版本只有租户管理员可以删除');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Skill" WHERE id = ${skillId} FOR UPDATE`;
      const { count } = await tx.skillVersion.deleteMany({ where: viewer.isTenantAdmin ? { id: versionId } : { id: versionId, status: 'draft' } });
      if (count === 0 && viewer.isTenantAdmin) throw notFound();
      await assertNotStale(tx, count, versionId);
      if ((await tx.skillVersion.count({ where: { skillId } })) === 0) await tx.skill.delete({ where: { id: skillId } });
    });
    await this.storage.delete(version.storageKey);
  }

  /** 删除整个 Skill（所有者或租户管理员）：版本、审核记录一并删除，并清理存储文件。 */
  async deleteSkill(actor: SkillViewer, skillId: string): Promise<void> {
    const skill = await this.prisma.skill.findFirst({ where: { id: skillId, tenantId: actor.tenantId } });
    if (!skill) throw notFound();
    await assertCanManage(this.prisma, actor, skill, '只有该 Skill 的所有者和租户管理员可以删除');
    await this.removeSkill(skillId);
  }

  /** 超管删除任意租户的 Skill */
  async adminDeleteSkill(skillId: string): Promise<void> {
    if (!(await this.prisma.skill.findUnique({ where: { id: skillId } }))) throw notFound();
    await this.removeSkill(skillId);
  }

  /** 租户管理员下架 / 上架本租户的 Skill */
  setUnlisted(actorUserId: string, tenantId: string, skillId: string, unlisted: boolean): Promise<void> {
    return this.applyUnlisted({ id: skillId, tenantId }, actorUserId, unlisted);
  }

  /** 超管下架 / 上架任意租户的 Skill */
  adminSetUnlisted(actorUserId: string, skillId: string, unlisted: boolean): Promise<void> {
    return this.applyUnlisted({ id: skillId }, actorUserId, unlisted);
  }

  /** 版本与文件保留，记一条 unlist / relist；按「当前状态」条件更新，重复操作返回 409。 */
  private async applyUnlisted(where: { id: string; tenantId?: string }, actorUserId: string, unlisted: boolean): Promise<void> {
    const skillId = where.id;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.skill.updateMany({ where: { ...where, unlisted: !unlisted }, data: { unlisted } });
      if (count === 0) {
        if (!(await tx.skill.findFirst({ where }))) throw notFound();
        throw new ConflictException(unlisted ? '这个 Skill 已经下架' : '这个 Skill 没有下架');
      }
      await tx.skillReviewRecord.create({ data: { skillId, action: unlisted ? 'unlist' : 'relist', actorUserId } });
    });
  }

  /** 超管下载任意版本（治理用，不计入下载次数） */
  async adminDownload(skillId: string, versionId: string): Promise<{ fileName: string; data: Buffer }> {
    const version = await this.prisma.skillVersion.findFirst({ where: { id: versionId, skillId }, include: { skill: true } });
    if (!version) throw notFound();
    return { fileName: `${version.skill.name}-${version.version}.zip`, data: await this.storage.read(version.storageKey) };
  }

  /** 先锁住 Skill（与上传新版本、删除版本互斥），再取全部版本的文件并删除；版本、审核记录、可见性名单随 Skill 级联删除 */
  private async removeSkill(skillId: string): Promise<void> {
    const storageKeys = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Skill" WHERE id = ${skillId} FOR UPDATE`;
      const versions = await tx.skillVersion.findMany({ where: { skillId }, select: { storageKey: true } });
      const { count } = await tx.skill.deleteMany({ where: { id: skillId } });
      if (count === 0) throw notFound();
      return versions.map((v) => v.storageKey);
    });
    for (const key of storageKeys) await this.storage.delete(key);
  }

  /** 下载包（文件名 <name>-<version>.zip）；正式版本成功读取后下载次数 +1，非正式版本（审阅用）不计数。 */
  async download(viewer: SkillViewer, skillId: string, versionId: string): Promise<{ fileName: string; data: Buffer }> {
    const version = await findVisibleVersion(this.prisma, viewer, skillId, versionId);
    const data = await this.storage.read(version.storageKey);
    if (version.status === 'published') {
      await this.prisma.skillVersion.update({ where: { id: version.id }, data: { downloadCount: { increment: 1 } } });
    }
    return { fileName: `${version.skill.name}-${version.version}.zip`, data };
  }

  /** 取当前员工可以修改或删除的草稿；状态不对时按 pendingMessage / publishedMessage 拒绝。 */
  private async findOwnDraft(viewer: SkillViewer, skillId: string, versionId: string, pendingMessage: string, publishedMessage: string) {
    const version = await findVisibleVersion(this.prisma, viewer, skillId, versionId);
    if (version.status === 'published') throw new ForbiddenException(publishedMessage);
    if (version.skill.ownerEmployeeId !== viewer.employeeId && version.uploaderEmployeeId !== viewer.employeeId) throw draftOwnerOnly();
    if (version.status === 'pending') throw new ConflictException(pendingMessage);
    return version;
  }

  /** 名称已存在时 409；上传人看不到已有的 Skill 时不返回其 id（不暴露看不到的 Skill） */
  private async assertNameFree(actor: SkillActor, name: string): Promise<void> {
    const existing = await this.prisma.skill.findUnique({ where: { tenantId_name: { tenantId: actor.tenantId, name } } });
    if (!existing) return;
    const body: SkillNameConflictBody = (await canViewSkill(this.prisma, actor, existing))
      ? { message: `本租户已存在名为「${name}」的 Skill，请到该 Skill 详情页上传新版本`, skillId: existing.id }
      : { message: `本租户已存在名为「${name}」的 Skill，请换一个名称` };
    throw new ConflictException(body);
  }

  /** 包先落盘再写库；写库失败（含校验失败、并发冲突）时删除已落盘的文件。 */
  private async withStoredPackage<T>(pkg: SkillPackage, write: (storageKey: string) => Promise<T>): Promise<T> {
    const storageKey = await this.storage.save(packSkill(pkg), 'zip');
    try {
      return await write(storageKey);
    } catch (err) {
      await this.storage.delete(storageKey);
      throw err;
    }
  }
}

function assertSameName(pkg: SkillPackage, skillName: string) {
  if (pkg.name !== skillName) throw new BadRequestException(`新版本 SKILL.md 的 name「${pkg.name}」与 Skill 名称「${skillName}」不一致`);
}

/** 写入版本及其初始状态对应的审核记录（直接发布 / 提交审核；存草稿不记）。 */
async function insertVersion(
  tx: Prisma.TransactionClient,
  skillId: string,
  pkg: SkillPackage,
  version: string,
  storageKey: string,
  uploader: SkillActor,
  state: InitialState,
): Promise<void> {
  const created = await tx.skillVersion.create({
    data: {
      skillId,
      ...parseSkillVersion(version)!,
      version,
      description: pkg.description,
      status: state.status,
      uploaderEmployeeId: uploader.employeeId,
      storageKey,
      sizeBytes: pkg.sizeBytes,
      fileCount: pkg.fileCount,
    },
  });
  if (state.action) await tx.skillReviewRecord.create({ data: { skillId, versionId: created.id, action: state.action, actorUserId: uploader.userId } });
}
