import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  compareSkillVersions,
  normalizeSkillPath,
  SKILL_ENTRY_FILE,
  SKILL_PREVIEW_MAX_CHARS,
  type SkillFileDiff,
  type SkillFileEntry,
  type SkillFilePreview,
  SkillPathError,
  type SkillReviewView,
  type SkillReviewViewerRole,
} from '@skill-hub/shared';
import { strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import type { AuthContext } from '../auth/session';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrivateFileStorage } from '../storage/private-file-storage';
import { unpackStored } from './skill-package';
import { toVisibilityInfo, withVisibility } from './skill-visibility';
import { BY_VERSION_DESC, RECORDS_NEWEST_FIRST, rejectComments, toRecordInfo, toVersionInfo, withRecordRelations, withUploader } from './skill-views';

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const versionWithTenant = { ...withUploader, skill: { include: { tenant: true, ...withVisibility } } } satisfies Prisma.SkillVersionInclude;
type VersionWithTenant = Prisma.SkillVersionGetPayload<{ include: typeof versionWithTenant }>;

// 不存在与无权限返回同样的 403，避免据此判断某个版本是否存在
const noAccess = () => new ForbiddenException('无权查看这个 Skill 版本');

/** 疑似二进制：前 8000 字节含 NUL，或不是合法的 UTF-8 */
function decodeText(data: Uint8Array): string | null {
  if (data.subarray(0, 8000).includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

/** 与基准版本按 sha256 比较，得出文件树（含每个文件的变化）与差异 */
function diffAgainstBase(files: Record<string, Uint8Array>, base: Record<string, Uint8Array> | null, baseVersion: string | null): { files: SkillFileEntry[]; diff: SkillFileDiff } {
  const baseHashes = new Map(Object.entries(base ?? {}).map(([path, data]) => [path, sha256(data)]));
  const entries: SkillFileEntry[] = Object.entries(files)
    .map(([path, data]): SkillFileEntry => {
      const before = baseHashes.get(path);
      return { path, size: data.length, change: before === undefined ? 'added' : before === sha256(data) ? 'unchanged' : 'modified' };
    })
    .sort((a, b) => byPath(a.path, b.path));
  return {
    files: entries,
    diff: {
      baseVersion,
      added: entries.filter((f) => f.change === 'added').map((f) => f.path),
      modified: entries.filter((f) => f.change === 'modified').map((f) => f.path),
      removed: [...baseHashes.keys()].filter((path) => !(path in files)).sort(byPath),
    },
  };
}

/**
 * 审核链接 /skills/review/:versionId：按身份授权，不依赖会话的当前租户（链接会被转发给处在其他租户的管理员）。
 * 该租户正常状态的租户管理员可以查看并在审核中时审核；所有者、超管只读；其他人（含版本不存在）一律 403。
 * 链接本身不带任何权限，仍须登录。
 */
@Injectable()
export class SkillReviewLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateFileStorage,
  ) {}

  async view(auth: AuthContext, versionId: string): Promise<SkillReviewView> {
    const { version, role, needsTenantSwitch } = await this.access(auth, versionId);
    const files = await this.readFiles(version, version.skill.name);

    // 比较基准：版本号比本版本小的最高正式版本
    const base = (await this.prisma.skillVersion.findMany({ where: { skillId: version.skillId, status: 'published' }, orderBy: BY_VERSION_DESC })).find(
      (v) => compareSkillVersions(v, version) < 0,
    );
    const baseFiles = base ? await this.readFiles(base, version.skill.name) : null;

    const records = await this.prisma.skillReviewRecord.findMany({ where: { versionId }, include: withRecordRelations, orderBy: RECORDS_NEWEST_FIRST });
    const comments = await rejectComments(this.prisma, version.status === 'draft' ? [versionId] : []);
    return {
      ...toVersionInfo(version),
      skillId: version.skillId,
      skillName: version.skill.name,
      status: version.status,
      rejectComment: comments.get(versionId) ?? null,
      skillMd: strFromU8(files[SKILL_ENTRY_FILE]),
      records: records.map(toRecordInfo),
      tenantId: version.skill.tenantId,
      tenantName: version.skill.tenant.name,
      viewerRole: role,
      canReview: role === 'tenant_admin' && version.status === 'pending',
      needsTenantSwitch,
      visibility: toVisibilityInfo(version.skill),
      ...diffAgainstBase(files, baseFiles, base?.version ?? null),
    };
  }

  /** 预览包内文件：只按包里实际存在的路径取，不访问文件系统；含 .. 或绝对路径直接拒绝。 */
  async previewFile(auth: AuthContext, versionId: string, rawPath: string | undefined): Promise<SkillFilePreview> {
    if (!rawPath) throw new BadRequestException('请指定要预览的文件');
    let path: string | null;
    try {
      path = normalizeSkillPath(rawPath);
    } catch (err) {
      if (err instanceof SkillPathError) throw new BadRequestException('文件路径不合法');
      throw err;
    }
    const { version } = await this.access(auth, versionId);
    const data = path === null ? undefined : (await this.readFiles(version, version.skill.name))[path];
    if (!data || path === null) throw new NotFoundException('文件不存在');

    const text = decodeText(data);
    if (text === null) return { path, size: data.length, binary: true, content: null, truncated: false };
    const truncated = text.length > SKILL_PREVIEW_MAX_CHARS;
    return { path, size: data.length, binary: false, content: truncated ? text.slice(0, SKILL_PREVIEW_MAX_CHARS) : text, truncated };
  }

  /** 下载审阅：与审核页同样按身份授权；审阅下载不计入下载次数。 */
  async download(auth: AuthContext, versionId: string): Promise<{ fileName: string; data: Buffer }> {
    const { version } = await this.access(auth, versionId);
    return { fileName: `${version.skill.name}-${version.version}.zip`, data: await this.storage.read(version.storageKey) };
  }

  private async readFiles(version: { storageKey: string }, skillName: string): Promise<Record<string, Uint8Array>> {
    return unpackStored(await this.storage.read(version.storageKey), skillName);
  }

  private async access(auth: AuthContext, versionId: string): Promise<{ version: VersionWithTenant; role: SkillReviewViewerRole; needsTenantSwitch: boolean }> {
    const version = await this.prisma.skillVersion.findUnique({ where: { id: versionId }, include: versionWithTenant });
    if (!version) throw noAccess();
    if (auth.isSuperAdmin) return { version, role: 'super_admin', needsTenantSwitch: false };

    const tenantId = version.skill.tenantId;
    const employee = await this.prisma.employee.findFirst({ where: { userId: auth.user.id, tenantId, status: 'active', tenant: { status: 'active' } } });
    if (employee?.isTenantAdmin) return { version, role: 'tenant_admin', needsTenantSwitch: auth.currentTenantId !== tenantId };
    if (employee && version.skill.ownerEmployeeId === employee.id) return { version, role: 'owner', needsTenantSwitch: false };
    throw noAccess();
  }
}
