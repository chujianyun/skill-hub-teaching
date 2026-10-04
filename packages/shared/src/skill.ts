import { parse } from 'yaml';

/** Skill 包上限（忽略垃圾文件后计算，见 spec 002）。 */
export const SKILL_MAX_MB = 20;
export const SKILL_MAX_BYTES = SKILL_MAX_MB * 1024 * 1024;
export const SKILL_MAX_FILES = 500;
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;
export const SKILL_ENTRY_FILE = 'SKILL.md';

/** 上传时自动忽略的文件/目录名（路径中任意一段命中即忽略）。 */
export const SKILL_IGNORED_NAMES = ['.DS_Store', '.git', 'node_modules', '__pycache__'];

export const isIgnoredSkillPath = (path: string) => path.split('/').some((segment) => SKILL_IGNORED_NAMES.includes(segment));

/** 文件数与总大小是否超出上限；超出时返回中文提示，否则返回 null。服务端与浏览器共用。 */
export function checkSkillLimits(fileCount: number, totalBytes: number): string | null {
  if (fileCount > SKILL_MAX_FILES) return `Skill 包最多 ${SKILL_MAX_FILES} 个文件`;
  if (totalBytes > SKILL_MAX_BYTES) return `Skill 包解压后不能超过 ${SKILL_MAX_MB}MB`;
  return null;
}

/**
 * Skill 根目录：SKILL.md 在根目录时为 ''，在唯一的顶层文件夹中时为「文件夹名/」，都不满足时返回 null。
 * paths 为规范化后的相对路径。服务端与浏览器共用。
 */
export function findSkillRoot(paths: string[]): string | null {
  if (paths.includes(SKILL_ENTRY_FILE)) return '';
  const tops = new Set(paths.map((p) => p.split('/')[0]));
  const [top] = tops;
  return tops.size === 1 && paths.includes(`${top}/${SKILL_ENTRY_FILE}`) ? `${top}/` : null;
}

/** zip 内的非法路径（绝对路径或含 ..，解压后会逃出目录）。 */
export class SkillPathError extends Error {
  constructor() {
    super('压缩包中包含非法路径');
  }
}

/** 把 zip 内的路径统一为 a/b/c；目录项返回 null；非法路径抛 SkillPathError。服务端与浏览器共用。 */
export function normalizeSkillPath(raw: string): string | null {
  if (raw.endsWith('/') || raw.endsWith('\\')) return null;
  const path = raw.replace(/\\/g, '/');
  const segments = path.split('/').filter((s) => s !== '' && s !== '.');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || segments.includes('..')) throw new SkillPathError();
  return segments.join('/');
}

const SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;

/** 解析 SKILL.md 的 frontmatter（Anthropic Skill 规范）：成功返回 name/description，否则返回中文错误提示。 */
export function parseSkillMd(content: string): { name: string; description: string } | { error: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { error: 'SKILL.md 开头缺少 frontmatter（用 --- 包裹的 name、description）' };
  let meta: unknown;
  try {
    meta = parse(match[1]);
  } catch {
    return { error: 'SKILL.md 的 frontmatter 格式不正确' };
  }
  const { name, description } = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim()) return { error: 'SKILL.md 缺少 name' };
  if (name.length > SKILL_NAME_MAX_LENGTH) return { error: `SKILL.md 的 name 不能超过 ${SKILL_NAME_MAX_LENGTH} 个字符` };
  if (!SKILL_NAME_PATTERN.test(name)) return { error: 'SKILL.md 的 name 只能包含小写字母、数字和连字符' };
  if (typeof description !== 'string' || !description.trim()) return { error: 'SKILL.md 缺少 description' };
  if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    return { error: `SKILL.md 的 description 不能超过 ${SKILL_DESCRIPTION_MAX_LENGTH} 个字符` };
  }
  return { name, description: description.trim() };
}

// 每段最多 9 位，保证落库为 32 位整数
export const SKILL_VERSION_PATTERN = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
export const SKILL_VERSION_FORMAT_MESSAGE = '版本号格式应为 x.y.z（如 1.0.0）';

export interface SkillVersionNumber {
  major: number;
  minor: number;
  patch: number;
}

/** 解析 x.y.z 版本号；格式不对返回 null。 */
export function parseSkillVersion(version: string): SkillVersionNumber | null {
  const match = SKILL_VERSION_PATTERN.exec(version);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

/** 按数值比较版本号（1.10.0 > 1.9.0）：a 更大返回正数，相等返回 0。 */
export const compareSkillVersions = (a: SkillVersionNumber, b: SkillVersionNumber) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

/** 审核状态设在版本上（ADR-0004）：草稿 / 审核中 / 正式 */
export type SkillVersionStatus = 'draft' | 'pending' | 'published';
export const SKILL_VERSION_STATUS_LABELS: Record<SkillVersionStatus, string> = { draft: '草稿', pending: '审核中', published: '正式' };

/** 审核记录的动作；驳回不是一种状态，而是把版本退回草稿的动作 */
export type SkillReviewAction = 'publish_direct' | 'submit' | 'withdraw' | 'approve' | 'reject' | 'reupload' | 'change_visibility' | 'change_category' | 'unlist' | 'relist';
export const SKILL_REVIEW_ACTION_LABELS: Record<SkillReviewAction, string> = {
  publish_direct: '直接发布',
  submit: '提交审核',
  withdraw: '撤回',
  approve: '通过',
  reject: '驳回',
  reupload: '重新上传',
  change_visibility: '修改可见性',
  change_category: '修改分类',
  unlist: '下架',
  relist: '上架',
};

/** 可见性（设在 Skill 上、对所有版本生效）：只能选一种；所有者、租户管理员、超管不受限制 */
export type SkillVisibility = 'tenant' | 'departments' | 'employees' | 'private';
export const SKILL_VISIBILITY_LABELS: Record<SkillVisibility, string> = {
  tenant: '租户可见',
  departments: '特定部门可见',
  employees: '特定员工可见',
  private: '仅自己可见',
};

/** 可见性设置：特定部门可见时 departmentIds（包含下级部门），特定员工可见时 employeeIds（所有者始终包含在内） */
export interface SkillVisibilityInput {
  visibility: SkillVisibility;
  departmentIds?: string[];
  employeeIds?: string[];
}

export interface SkillVisibilityInfo {
  visibility: SkillVisibility;
  departments: { id: string; name: string }[];
  employees: { id: string; name: string }[];
}

/** 可见性的文字描述，如「特定部门可见：研发部、运营部（含下级部门）」；详情页与审核记录共用 */
export function describeSkillVisibility(info: SkillVisibilityInfo): string {
  const label = SKILL_VISIBILITY_LABELS[info.visibility];
  if (info.visibility === 'departments' && info.departments.length) return `${label}：${info.departments.map((d) => d.name).join('、')}（含下级部门）`;
  if (info.visibility === 'employees' && info.employees.length) return `${label}：${info.employees.map((e) => e.name).join('、')}`;
  return label;
}

/** 选可见范围用的本租户部门树与在职员工（本租户员工均可读取） */
export interface SkillVisibilityOptions {
  departments: { id: string; parentId: string | null; name: string }[];
  employees: { id: string; name: string; departmentName: string }[];
}

/** 对版本执行的审核步骤（POST /api/skills/:id/versions/:versionId/<step>） */
export type SkillReviewStep = 'submit' | 'withdraw' | 'approve' | 'reject' | 'publish';

/**
 * 上传时的去向：租户管理员可选「直接发布」或「存草稿」，其他员工可选「存草稿」或「提交审核」。
 * 缺省时管理员为 publish、员工为 submit。
 */
export type SkillUploadMode = 'publish' | 'draft' | 'submit';

export const SKILL_REJECT_COMMENT_MAX_LENGTH = 500;

export interface SkillVersionInfo {
  id: string;
  version: string;
  /** 取自该版本的 SKILL.md */
  description: string;
  /** 上传人（Employee）的当前姓名 */
  uploaderName: string;
  uploadedAt: string;
  sizeBytes: number;
  fileCount: number;
  downloadCount: number;
}

/** Skill 分类（#20）：租户管理员维护，一个 Skill 最多一个分类 */
export interface SkillCategory {
  id: string;
  name: string;
}

/** 分类列表的一项；skillCount 只对租户管理员返回（本租户使用该分类的 Skill 数，含未发布、已下架的），其他人为 null */
export interface SkillCategoryItem extends SkillCategory {
  skillCount: number | null;
}

export const SKILL_CATEGORY_NAME_MAX_LENGTH = 20;
export const SKILL_CATEGORIES_MAX = 50;
/** 一键添加的常用分类（只补上本租户还没有的） */
export const SKILL_CATEGORY_PRESETS = ['研发', '办公', '电商', '行政', '财务', '法务', 'HR', '运营'];
/** 管理视图筛选「未分类」时 categoryId 取这个值 */
export const SKILL_UNCATEGORIZED = 'none';

export interface SkillCategoryRequest {
  name: string;
}

export interface UpdateSkillCategoryRequest {
  /** null 表示清空（未分类） */
  categoryId: string | null;
}

export interface SkillSummary {
  id: string;
  name: string;
  category: SkillCategory | null;
  /** 当前版本：版本号最高的正式版本 */
  currentVersion: SkillVersionInfo;
}

/** 非正式版本（草稿或审核中）；同一个 Skill 同时最多一个 */
export interface SkillWorkingVersion extends SkillVersionInfo {
  status: 'draft' | 'pending';
  /** 草稿是被驳回退回的：最近一次驳回的意见；否则为 null */
  rejectComment: string | null;
  /** 当前登录员工就是这个版本的上传人（可修改、删除自己的草稿；租户管理员可直接发布自己的草稿） */
  uploadedByMe: boolean;
}

export interface SkillReviewRecordInfo {
  id: string;
  skillId: string;
  skillName: string;
  /** 版本被删除后为 null */
  versionId: string | null;
  version: string | null;
  action: SkillReviewAction;
  /** 操作人（User）的当前姓名 */
  actorName: string;
  comment: string;
  createdAt: string;
}

export interface SkillDetail {
  id: string;
  name: string;
  ownerName: string;
  category: SkillCategory | null;
  /** 所有者的员工档案 id（特定员工可见时所有者始终在名单中） */
  ownerEmployeeId: string;
  /** 当前登录员工是否为所有者 */
  isOwner: boolean;
  /** 当前版本：版本号最高的正式版本；还没有正式版本时为 null（只有所有者和租户管理员能看到这样的 Skill） */
  currentVersion: SkillVersionInfo | null;
  /** 版本历史：所有正式版本，按版本号从新到旧 */
  versions: SkillVersionInfo[];
  /** 已有的最高版本号（含非正式版本）：新版本号必须比它大 */
  highestVersion: string;
  /** 非正式版本：只对所有者和租户管理员返回，其他人为 null */
  workingVersion: SkillWorkingVersion | null;
  /** 该 Skill 的审核记录（从新到旧）：只对所有者和租户管理员返回，其他人为空 */
  reviewRecords: SkillReviewRecordInfo[];
  visibility: SkillVisibilityInfo;
  /** 已下架：除所有者与管理员外看不到也下载不了 */
  unlisted: boolean;
}

/** 版本详情（审核页）：版本信息 + SKILL.md 原文 + 该版本的审核记录 */
export interface SkillVersionDetail extends SkillVersionInfo {
  skillId: string;
  skillName: string;
  status: SkillVersionStatus;
  rejectComment: string | null;
  skillMd: string;
  records: SkillReviewRecordInfo[];
}

/** 与上一个正式版本相比的变化：新增 / 修改 / 未变（没有可比较的版本时全部为新增） */
export type SkillFileChange = 'added' | 'modified' | 'unchanged';

/** 包内文件（审核页文件树）：相对 Skill 根目录的路径 */
export interface SkillFileEntry {
  path: string;
  size: number;
  change: SkillFileChange;
}

/** 与上一个正式版本（版本号比本版本小的最高正式版本）的文件级差异，按 sha256 判断 */
export interface SkillFileDiff {
  /** 比较基准的版本号；本版本之前没有正式版本时为 null（全部为新增） */
  baseVersion: string | null;
  added: string[];
  modified: string[];
  removed: string[];
}

/** 文本文件预览；二进制文件只给文件名和大小 */
export interface SkillFilePreview {
  path: string;
  size: number;
  binary: boolean;
  /** 文本内容；超过预览上限时截断 */
  content: string | null;
  truncated: boolean;
}

/** 文本预览最多返回的字符数，超出截断 */
export const SKILL_PREVIEW_MAX_CHARS = 512 * 1024;

/** 打开审核链接的人：该租户的租户管理员、所有者、超管（其他人无权限） */
export type SkillReviewViewerRole = 'tenant_admin' | 'owner' | 'super_admin';

/**
 * 审核链接 /skills/review/:versionId 的内容（GET /api/skills/review-links/:versionId）：按身份授权，不依赖会话的当前租户。
 * 只有租户管理员且版本在审核中时可以审核，其他情况只读。
 */
export interface SkillReviewView extends SkillVersionDetail {
  tenantId: string;
  tenantName: string;
  viewerRole: SkillReviewViewerRole;
  canReview: boolean;
  /** 租户管理员当前不在该租户：需要先切换租户才能审核 */
  needsTenantSwitch: boolean;
  files: SkillFileEntry[];
  diff: SkillFileDiff;
  visibility: SkillVisibilityInfo;
}

/** 审核链接（前端地址），与版本一一对应：撤回后再次提交仍是同一个链接 */
export const skillReviewPath = (versionId: string) => `/skills/review/${versionId}`;

/** 目录（员工）的搜索：名称或描述包含 keyword；uploaderId 为上传过该 Skill 任一版本的员工 */
export interface SkillListQuery {
  keyword?: string;
  uploaderId?: string;
  /** 按分类筛选；管理视图另可传 SKILL_UNCATEGORIZED 筛选未分类 */
  categoryId?: string;
}

/** 管理视图（租户管理员、超管）的筛选：在目录搜索之外，按审核状态（有该状态的版本）、可见性、是否下架筛选 */
export interface SkillManageQuery extends SkillListQuery {
  status?: SkillVersionStatus;
  visibility?: SkillVisibility;
  unlisted?: 'true' | 'false';
}

/** 管理视图的一行：包含还没有正式版本、已下架的 Skill */
export interface SkillManageRow {
  id: string;
  name: string;
  ownerName: string;
  /** 当前版本（没有正式版本时为 null） */
  currentVersion: SkillVersionInfo | null;
  /** 非正式版本的状态（草稿 / 审核中），没有时为 null */
  workingStatus: 'draft' | 'pending' | null;
  visibility: SkillVisibility;
  category: SkillCategory | null;
  unlisted: boolean;
  updatedAt: string;
}

/** 「我的 Skill」：我是所有者的 Skill */
export interface MySkill {
  id: string;
  name: string;
  currentVersion: SkillVersionInfo | null;
  workingVersion: SkillWorkingVersion | null;
}

/** 待审核列表的一项 */
export interface PendingSkillReview {
  skillId: string;
  skillName: string;
  /** 该 Skill 还没有正式版本（首次提交） */
  isNewSkill: boolean;
  version: SkillVersionInfo;
  submittedAt: string;
}

export interface SkillReviewRecordPage {
  items: SkillReviewRecordInfo[];
  total: number;
  page: number;
  pageSize: number;
}

/** 菜单红点：管理员的待审核数；员工被驳回且尚未处理（仍是草稿）的版本数 */
export interface SkillBadges {
  pendingReviews: number;
  rejectedDrafts: number;
}

export interface RejectSkillVersionRequest {
  comment: string;
}

/** 新建 Skill 时名称已存在（409）：上传人能看到已有 Skill 时带上其 id，引导去详情页上传新版本 */
export interface SkillNameConflictBody {
  message: string;
  skillId?: string;
}

/** 默认的下一个版本号：在给定的最高版本上加一个补丁号 */
export function nextPatchVersion(version: string): string {
  const v = parseSkillVersion(version);
  return v ? `${v.major}.${v.minor}.${v.patch + 1}` : '1.0.0';
}

/** 上传 Skill 的 multipart 表单：file 为 zip，version 为版本号，mode 为上传后的去向；新建时可带可见性（缺省租户可见）。 */
export interface UploadSkillRequest extends Partial<SkillVisibilityInput> {
  version: string;
  mode?: SkillUploadMode;
  /** 分类（仅新建 Skill 时生效，可不选） */
  categoryId?: string;
}
