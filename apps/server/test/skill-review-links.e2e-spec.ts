import type { NestExpressApplication } from '@nestjs/platform-express';
import type { SkillDetail, SkillFilePreview, SkillReviewView } from '@skill-hub/shared';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { sessionAgent } from './users';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedSuperAdmin } from './users';
import { createTestApp } from './app';
import { resetDatabase } from './reset-database';
import { skillMd, zipOf } from './skill-zips';
import { employeeAgent, superAdminAgent, tenantAdminAgent } from './users';

describe('Skill 审核链接 /api/skills/review-links', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;
  let owner: TestAgent;
  let other: TestAgent;
  let tenantId: string;
  let rootId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedSuperAdmin(prisma);
    ({ agent: admin, tenantId, rootId } = await tenantAdminAgent(app, prisma, '甲公司', '13900000001'));
    ({ agent: owner } = await employeeAgent(app, prisma, tenantId, rootId, '13800000001', '李雷'));
    ({ agent: other } = await employeeAgent(app, prisma, tenantId, rootId, '13800000002', '韩梅梅'));
  });

  afterAll(async () => {
    await app.close();
  });

  const pkg = (files: Record<string, string | Uint8Array>) => zipOf({ 'SKILL.md': skillMd('pdf-tools'), ...files });
  const create = (as: TestAgent, files: Record<string, string | Uint8Array>, mode?: string) => {
    const req = as.post('/api/skills').attach('file', pkg(files), 'skill.zip').field('version', '1.0.0');
    return mode ? req.field('mode', mode) : req;
  };
  const newVersion = (as: TestAgent, skillId: string, version: string, files: Record<string, string | Uint8Array>, mode?: string) => {
    const req = as.post(`/api/skills/${skillId}/versions`).attach('file', pkg(files), 'skill.zip').field('version', version);
    return mode ? req.field('mode', mode) : req;
  };
  const view = async (as: TestAgent, versionId: string): Promise<SkillReviewView> => (await as.get(`/api/skills/review-links/${versionId}`).expect(200)).body;
  const preview = (as: TestAgent, versionId: string, path: string) => as.get(`/api/skills/review-links/${versionId}/file`).query({ path });

  /** 员工新建 pdf-tools 1.0.0 并提交审核 */
  async function pendingFirstVersion(files: Record<string, string | Uint8Array> = { 'a.md': 'A' }) {
    const skill: SkillDetail = (await create(owner, files).expect(201)).body;
    return { skillId: skill.id, versionId: skill.workingVersion!.id };
  }

  describe('按身份打开链接', () => {
    it('本租户的租户管理员：可以审核，返回版本信息、SKILL.md、文件树、差异与审核记录', async () => {
      const { skillId, versionId } = await pendingFirstVersion();

      const v = await view(admin, versionId);

      expect(v).toMatchObject({
        skillId,
        skillName: 'pdf-tools',
        version: '1.0.0',
        status: 'pending',
        tenantId,
        tenantName: '甲公司',
        viewerRole: 'tenant_admin',
        canReview: true,
        needsTenantSwitch: false,
        skillMd: skillMd('pdf-tools'),
      });
      expect(v.records.map((r) => r.action)).toEqual(['submit']);
    });

    it('管理员当前处在另一个租户：仍能打开，并提示需要先切换到该租户', async () => {
      const { versionId } = await pendingFirstVersion();
      // 用户 X 同时是甲公司与乙公司的租户管理员，当前在乙公司
      const { tenantId: tenantB, rootId: rootB } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');
      const x = await prisma.user.create({ data: { phone: '13900000099', name: '双租户管理员', nickname: '双' } });
      await prisma.employee.create({ data: { userId: x.id, tenantId, departmentId: rootId, isTenantAdmin: true } });
      await prisma.employee.create({ data: { userId: x.id, tenantId: tenantB, departmentId: rootB, isTenantAdmin: true } });
      const agent = await sessionAgent(app, prisma, x.id, tenantB);

      expect(await view(agent, versionId)).toMatchObject({ viewerRole: 'tenant_admin', canReview: true, needsTenantSwitch: true, tenantId });

      // 切换后即可在租户内审核
      await prisma.session.updateMany({ where: { userId: x.id }, data: { currentTenantId: tenantId } });
      expect(await view(agent, versionId)).toMatchObject({ needsTenantSwitch: false });
    });

    it('版本已被处理：管理员只读，审核记录里有处理结果', async () => {
      const { skillId, versionId } = await pendingFirstVersion();
      await admin.post(`/api/skills/${skillId}/versions/${versionId}/reject`).send({ comment: '请补充示例' }).expect(204);

      const v = await view(admin, versionId);

      expect(v).toMatchObject({ status: 'draft', canReview: false, rejectComment: '请补充示例' });
      expect(v.records[0]).toMatchObject({ action: 'reject', actorName: '甲公司管理员', comment: '请补充示例' });
    });

    it('所有者只读；超管只读', async () => {
      const { versionId } = await pendingFirstVersion();
      expect(await view(owner, versionId)).toMatchObject({ viewerRole: 'owner', canReview: false });
      const superAdmin = await superAdminAgent(app, prisma);
      expect(await view(superAdmin, versionId)).toMatchObject({ viewerRole: 'super_admin', canReview: false, tenantName: '甲公司' });
    });

    it('其他员工、其他租户的人、被停用的管理员无权限；版本不存在也返回无权限（不暴露是否存在）；未登录 401', async () => {
      const { versionId } = await pendingFirstVersion();
      const { agent: otherTenantAdmin } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');

      for (const agent of [other, otherTenantAdmin]) {
        expect((await agent.get(`/api/skills/review-links/${versionId}`).expect(403)).body.message).toBe('无权查看这个 Skill 版本');
      }
      await request(app.getHttpServer()).get(`/api/skills/review-links/${versionId}`).expect(401);
      expect((await admin.get('/api/skills/review-links/not-exist').expect(403)).body.message).toBe('无权查看这个 Skill 版本');

      await prisma.employee.updateMany({ where: { tenantId, isTenantAdmin: true }, data: { status: 'disabled' } });
      await admin.get(`/api/skills/review-links/${versionId}`).expect(403);
    });

    it('撤回后再次提交，链接（版本 id）不变', async () => {
      const { skillId, versionId } = await pendingFirstVersion();
      await owner.post(`/api/skills/${skillId}/versions/${versionId}/withdraw`).expect(204);
      await owner.post(`/api/skills/${skillId}/versions/${versionId}/submit`).expect(204);
      expect(await view(admin, versionId)).toMatchObject({ status: 'pending', canReview: true });
    });
  });

  describe('文件树与文件级差异', () => {
    it('首个版本：没有可比较的版本，全部为新增', async () => {
      const { versionId } = await pendingFirstVersion({ 'scripts/run.sh': 'echo 1\n', 'docs/guide.md': '# 指南\n' });

      const v = await view(admin, versionId);

      expect(v.files).toEqual([
        { path: 'SKILL.md', size: Buffer.byteLength(skillMd('pdf-tools')), change: 'added' },
        { path: 'docs/guide.md', size: Buffer.byteLength('# 指南\n'), change: 'added' },
        { path: 'scripts/run.sh', size: 7, change: 'added' },
      ]);
      expect(v.diff).toEqual({ baseVersion: null, added: ['SKILL.md', 'docs/guide.md', 'scripts/run.sh'], modified: [], removed: [] });
    });

    it('新版本与上一个正式版本比较：新增、修改、删除按内容（sha256）判断', async () => {
      const skill: SkillDetail = (await create(admin, { 'keep.md': 'same', 'change.md': 'v1', 'drop.md': 'bye' }).expect(201)).body;
      const updated: SkillDetail = (await newVersion(admin, skill.id, '1.1.0', { 'keep.md': 'same', 'change.md': 'v2', 'new.md': 'hi' }, 'draft').expect(201)).body;

      const v = await view(admin, updated.workingVersion!.id);

      expect(v.diff).toEqual({ baseVersion: '1.0.0', added: ['new.md'], modified: ['change.md'], removed: ['drop.md'] });
      expect(Object.fromEntries(v.files.map((f) => [f.path, f.change]))).toEqual({ 'SKILL.md': 'unchanged', 'change.md': 'modified', 'keep.md': 'unchanged', 'new.md': 'added' });
    });

    it('基准是版本号比本版本小的最高正式版本（已是正式的旧版本也与更早的正式版本比较）', async () => {
      const skill: SkillDetail = (await create(admin, { 'f.md': '1' }).expect(201)).body;
      await newVersion(admin, skill.id, '1.1.0', { 'f.md': '2' }).expect(201);
      const v3: SkillDetail = (await newVersion(admin, skill.id, '2.0.0', { 'f.md': '3' }, 'draft').expect(201)).body;

      expect((await view(admin, v3.workingVersion!.id)).diff.baseVersion).toBe('1.1.0');
      expect((await view(admin, v3.versions[0].id)).diff).toMatchObject({ baseVersion: '1.0.0', modified: ['f.md'] });
      expect((await view(admin, v3.versions[1].id)).diff.baseVersion).toBeNull();
    });
  });

  describe('下载审阅', () => {
    it('能打开链接的人都能下载审阅包，不计入下载次数；无权限的人 403', async () => {
      const { versionId } = await pendingFirstVersion();
      const superAdmin = await superAdminAgent(app, prisma);
      for (const agent of [admin, owner, superAdmin]) {
        const res = await agent.get(`/api/skills/review-links/${versionId}/download`).expect(200);
        expect(res.headers['content-disposition']).toBe('attachment; filename="pdf-tools-1.0.0.zip"');
      }
      await other.get(`/api/skills/review-links/${versionId}/download`).expect(403);
      expect((await prisma.skillVersion.findUniqueOrThrow({ where: { id: versionId } })).downloadCount).toBe(0);
    });
  });

  describe('文件预览', () => {
    it('文本文件返回内容；二进制文件只给文件名和大小', async () => {
      const bin = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]);
      const { versionId } = await pendingFirstVersion({ 'scripts/run.sh': 'echo 你好\n', 'img/logo.png': bin });

      const text: SkillFilePreview = (await preview(admin, versionId, 'scripts/run.sh').expect(200)).body;
      const binary: SkillFilePreview = (await preview(admin, versionId, 'img/logo.png').expect(200)).body;

      expect(text).toEqual({ path: 'scripts/run.sh', size: Buffer.byteLength('echo 你好\n'), binary: false, content: 'echo 你好\n', truncated: false });
      expect(binary).toEqual({ path: 'img/logo.png', size: 8, binary: true, content: null, truncated: false });
    });

    it('超过预览上限的文本被截断', async () => {
      const { versionId } = await pendingFirstVersion({ 'big.txt': 'x'.repeat(512 * 1024 + 10) });
      const res: SkillFilePreview = (await preview(admin, versionId, 'big.txt').expect(200)).body;
      expect(res).toMatchObject({ binary: false, truncated: true });
      expect(res.content).toHaveLength(512 * 1024);
    });

    it.each([['../../etc/passwd'], ['/etc/passwd'], ['a/../../SKILL.md'], ['..%2F..%2Fetc%2Fpasswd']])('路径 %s 不能穿越到包外', async (path) => {
      const { versionId } = await pendingFirstVersion();
      const res = await preview(admin, versionId, path);
      expect([400, 404]).toContain(res.status);
      expect(res.body.content).toBeUndefined();
    });

    it('包里没有的文件 404；没传 path 400；无权限的人 403', async () => {
      const { versionId } = await pendingFirstVersion();
      expect((await preview(admin, versionId, 'missing.md').expect(404)).body.message).toBe('文件不存在');
      expect((await admin.get(`/api/skills/review-links/${versionId}/file`).expect(400)).body.message).toBe('请指定要预览的文件');
      await preview(other, versionId, 'SKILL.md').expect(403);
      await preview(owner, versionId, 'SKILL.md').expect(200);
    });
  });
});
