import type { NestExpressApplication } from '@nestjs/platform-express';
import { SKILL_MAX_BYTES, SKILL_VERSION_FORMAT_MESSAGE, type SkillDetail as SharedSkillDetail, type SkillSummary, type SkillVersionInfo } from '@skill-hub/shared';
import { strFromU8, unzipSync } from 'fflate';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedSuperAdmin } from './users';
import { createTestApp } from './app';
import { resetDatabase } from './reset-database';
import { binary, skillFolderZip, skillMd, versionZip, zipOf } from './skill-zips';
import { employeeAgent, superAdminAgent, tenantAdminAgent } from './users';

/** 本文件的 Skill 都已有正式版本（管理员上传直接发布），当前版本必然存在 */
type SkillDetail = SharedSkillDetail & { currentVersion: SkillVersionInfo };

const UPLOAD_DIR = process.env.UPLOAD_DIR!;
const PRIVATE_DIR = process.env.PRIVATE_UPLOAD_DIR!;


describe('Skill /api/skills', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;
  let employee: TestAgent;
  let tenantId: string;
  let rootId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedSuperAdmin(prisma);
    ({ agent: admin, tenantId, rootId } = await tenantAdminAgent(app, prisma, '甲公司', '13900000001'));
    ({ agent: employee } = await employeeAgent(app, prisma, tenantId, rootId, '13800000001', '李雷'));
  });

  afterAll(async () => {
    await app.close();
  });

  /** version 传 null 表示表单里不带版本号 */
  function upload(zip: Buffer, version: string | null = '1.0.0', as = admin) {
    const req = as.post('/api/skills').attach('file', zip, 'skill.zip');
    return version === null ? req : req.field('version', version);
  }

  async function uploadOk(name = 'pdf-tools', version = '1.0.0'): Promise<SkillDetail> {
    return (await upload(skillFolderZip(name), version).expect(201)).body;
  }

  function download(as: TestAgent, skillId: string, versionId: string) {
    return as.get(`/api/skills/${skillId}/versions/${versionId}/download`).buffer(true).parse(binary);
  }

  const privateFiles = () => (existsSync(PRIVATE_DIR) ? readdirSync(PRIVATE_DIR) : []);

  describe('租户管理员上传', () => {
    it('上传顶层文件夹形式的 Skill：直接成为正式版本，记录版本号、上传人、上传时间，并留下 publish_direct 审核记录', async () => {
      const before = Date.now();
      const skill = await uploadOk('pdf-tools', '1.2.3');

      expect(skill).toMatchObject({
        name: 'pdf-tools',
        ownerName: '甲公司管理员',
        currentVersion: { version: '1.2.3', description: 'pdf-tools 的说明', uploaderName: '甲公司管理员', fileCount: 3 },
      });
      expect(new Date(skill.currentVersion.uploadedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

      const version = await prisma.skillVersion.findUniqueOrThrow({ where: { id: skill.currentVersion.id } });
      expect(version).toMatchObject({ status: 'published', major: 1, minor: 2, patch: 3 });
      const records = await prisma.skillReviewRecord.findMany({ where: { skillId: skill.id } });
      expect(records).toEqual([expect.objectContaining({ versionId: version.id, action: 'publish_direct' })]);
    });

    it('SKILL.md 直接在压缩包根目录也可以上传', async () => {
      const zip = zipOf({ 'SKILL.md': skillMd('root-skill'), 'a.txt': 'a' });
      const res = await upload(zip).expect(201);
      expect(res.body).toMatchObject({ name: 'root-skill', currentVersion: { fileCount: 2 } });
    });

    it('description 支持 YAML 多行写法，首尾空白被去掉', async () => {
      const md = '---\nname: multi-line\ndescription: >-\n  第一行\n  第二行\n---\n正文\n';
      const res = await upload(zipOf({ 'multi-line/SKILL.md': md })).expect(201);
      expect(res.body.currentVersion.description).toBe('第一行 第二行');
    });

    it('垃圾文件（.DS_Store、.git、node_modules、__pycache__）被忽略：不计入文件数和大小，也不出现在包里', async () => {
      const zip = zipOf({
        'junk/SKILL.md': skillMd('junk'),
        'junk/.DS_Store': 'x',
        'junk/.git/config': 'x',
        'junk/sub/__pycache__/a.pyc': 'x',
        // 超过上限的大文件在 node_modules 里，被忽略后不影响上传
        'junk/node_modules/big/blob.bin': new Uint8Array(SKILL_MAX_BYTES + 1),
        'junk/sub/keep.py': 'print(1)',
      });

      const skill: SkillDetail = (await upload(zip).expect(201)).body;

      expect(skill.currentVersion.fileCount).toBe(2);
      const res = await download(admin, skill.id, skill.currentVersion.id).expect(200);
      expect(Object.keys(unzipSync(res.body)).sort()).toEqual(['junk/SKILL.md', 'junk/sub/keep.py']);
    });

    it.each([
      ['缺少 SKILL.md', { 'a/readme.md': 'x' }],
      ['SKILL.md 藏在更深的目录', { 'a/b/SKILL.md': skillMd('deep') }],
      ['有多个顶层文件夹', { 'a/SKILL.md': skillMd('a'), 'b/x.md': 'x' }],
    ])('%s 被拒绝', async (_case, files) => {
      const res = await upload(zipOf(files)).expect(400);
      expect(res.body.message).toBe('根目录（或唯一的顶层文件夹）中缺少 SKILL.md');
    });

    it.each([
      ['没有 frontmatter', '# 只有正文\n', 'SKILL.md 开头缺少 frontmatter（用 --- 包裹的 name、description）'],
      ['frontmatter 不是合法 YAML', '---\nname: [oops\n---\n', 'SKILL.md 的 frontmatter 格式不正确'],
      ['缺少 name', '---\ndescription: 说明\n---\n', 'SKILL.md 缺少 name'],
      ['name 含大写字母', '---\nname: PDF-Tools\ndescription: 说明\n---\n', 'SKILL.md 的 name 只能包含小写字母、数字和连字符'],
      ['name 含中文', '---\nname: 工具\ndescription: 说明\n---\n', 'SKILL.md 的 name 只能包含小写字母、数字和连字符'],
      ['name 超过 64 个字符', `---\nname: ${'a'.repeat(65)}\ndescription: 说明\n---\n`, 'SKILL.md 的 name 不能超过 64 个字符'],
      ['缺少 description', '---\nname: no-desc\n---\n', 'SKILL.md 缺少 description'],
      ['description 超过 1024 个字符', `---\nname: long-desc\ndescription: ${'长'.repeat(1025)}\n---\n`, 'SKILL.md 的 description 不能超过 1024 个字符'],
    ])('SKILL.md %s 被拒绝', async (_case, md, message) => {
      const res = await upload(zipOf({ 'SKILL.md': md })).expect(400);
      expect(res.body.message).toBe(message);
    });

    it('恰好 500 个文件可以上传，超过 500 个被拒绝', async () => {
      const files = (n: number, name: string) => {
        const map: Record<string, string> = { 'SKILL.md': skillMd(name) };
        for (let i = 1; i < n; i++) map[`f/${i}.txt`] = String(i);
        return map;
      };
      await upload(zipOf(files(500, 'five-hundred'))).expect(201);
      const res = await upload(zipOf(files(501, 'too-many'))).expect(400);
      expect(res.body.message).toBe('Skill 包最多 500 个文件');
    });

    it('解压后超过 20MB 被拒绝', async () => {
      const zip = zipOf({ 'SKILL.md': skillMd('too-big'), 'data.bin': new Uint8Array(SKILL_MAX_BYTES) });
      const res = await upload(zip).expect(400);
      expect(res.body.message).toBe('Skill 包解压后不能超过 20MB');
    });

    it('上传的压缩包本身超过上限返回 413', async () => {
      const res = await upload(Buffer.alloc(SKILL_MAX_BYTES + 5 * 1024 * 1024 + 1)).expect(413);
      expect(res.body.message).toBe('Skill 包不能超过 20MB');
    });

    it('不是 zip 的文件被拒绝', async () => {
      const res = await upload(Buffer.from('not a zip')).expect(400);
      expect(res.body.message).toBe('无法解析上传的压缩包，请确认是 zip 格式');
    });

    it('压缩包中有 .. 路径（解压会逃出目录）被拒绝', async () => {
      const res = await upload(zipOf({ 'SKILL.md': skillMd('evil'), '../evil.sh': 'rm -rf /' })).expect(400);
      expect(res.body.message).toBe('压缩包中包含非法路径');
    });

    it('未选择文件被拒绝', async () => {
      const res = await admin.post('/api/skills').field('version', '1.0.0').expect(400);
      expect(res.body.message).toBe('请选择要上传的 Skill 文件夹');
    });

    it.each([
      ['缺少版本号', null, '请填写版本号'],
      ['只有两段', '1.0', SKILL_VERSION_FORMAT_MESSAGE],
      ['带 v 前缀', 'v1.0.0', SKILL_VERSION_FORMAT_MESSAGE],
      ['有前导零', '01.0.0', SKILL_VERSION_FORMAT_MESSAGE],
      ['某段超过 9 位', '1234567890.0.0', SKILL_VERSION_FORMAT_MESSAGE],
    ])('版本号%s被拒绝', async (_case, version, message) => {
      const res = await upload(skillFolderZip('versioned'), version).expect(400);
      expect(res.body.message).toBe(message);
    });

    it('本租户内名称重复被拒绝并给出已有 Skill（引导去上传新版本）；其他租户可以用同一个名称', async () => {
      const existing = await uploadOk('pdf-tools');

      const res = await upload(skillFolderZip('pdf-tools', 'another-folder')).expect(409);
      expect(res.body).toMatchObject({ message: '本租户已存在名为「pdf-tools」的 Skill，请到该 Skill 详情页上传新版本', skillId: existing.id });

      const { agent: other } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');
      await upload(skillFolderZip('pdf-tools'), '1.0.0', other).expect(201);
    });

    it('上传失败时不会在私有存储里留下文件', async () => {
      await uploadOk('pdf-tools');
      const before = privateFiles();

      await upload(skillFolderZip('pdf-tools')).expect(409);
      await upload(zipOf({ 'a/readme.md': 'x' })).expect(400);

      expect(privateFiles().sort()).toEqual(before.sort());
    });

    it('超管不能上传，也不能访问租户内的 Skill 接口', async () => {
      const superAdmin = await superAdminAgent(app, prisma);
      await upload(skillFolderZip('by-admin'), '1.0.0', superAdmin).expect(403);
      await superAdmin.get('/api/skills').expect(403);
    });
  });

  describe('浏览与下载', () => {
    it('员工能在列表中看到本租户的 Skill，按名称排序，带当前版本信息', async () => {
      await uploadOk('zeta-skill', '2.0.0');
      await uploadOk('alpha-skill');

      const res = await employee.get('/api/skills').expect(200);

      const list: SkillSummary[] = res.body;
      expect(list.map((s) => s.name)).toEqual(['alpha-skill', 'zeta-skill']);
      expect(list[1].currentVersion).toMatchObject({ version: '2.0.0', description: 'zeta-skill 的说明', uploaderName: '甲公司管理员' });
    });

    it('员工能查看详情（看不到审核记录与非正式版本）', async () => {
      const skill = await uploadOk();
      const res = await employee.get(`/api/skills/${skill.id}`).expect(200);
      expect(res.body).toEqual({ ...skill, isOwner: false, workingVersion: null, reviewRecords: [] });
      expect(skill.reviewRecords).toHaveLength(1); // 管理员上传后的返回里有 publish_direct 记录
    });

    it('员工下载得到 <name>-<版本>.zip，解压后是 <name>/SKILL.md…，内容与上传一致', async () => {
      // 上传时的顶层文件夹名与 name 不同，下载时统一为 name
      const skill: SkillDetail = (await upload(skillFolderZip('pdf-tools', 'My PDF Folder')).expect(201)).body;

      const res = await download(employee, skill.id, skill.currentVersion.id).expect(200);

      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toBe('attachment; filename="pdf-tools-1.0.0.zip"');
      const files = unzipSync(res.body);
      expect(Object.keys(files).sort()).toEqual(['pdf-tools/SKILL.md', 'pdf-tools/reference/guide.md', 'pdf-tools/scripts/run.sh']);
      expect(strFromU8(files['pdf-tools/scripts/run.sh'])).toBe('echo hello\n');
    });

    it('Skill 包放在与公开上传目录分开的私有目录中，不能经 /api/uploads/ 访问', async () => {
      const skill = await uploadOk();
      const { storageKey } = await prisma.skillVersion.findUniqueOrThrow({ where: { id: skill.currentVersion.id } });
      expect(privateFiles()).toContain(storageKey);
      expect(existsSync(join(UPLOAD_DIR, storageKey))).toBe(false);

      await request(app.getHttpServer()).get(`/api/uploads/${storageKey}`).expect(404);
    });

    it('未登录不能浏览或下载', async () => {
      const skill = await uploadOk();
      const anonymous = request(app.getHttpServer());
      await anonymous.get('/api/skills').expect(401);
      await anonymous.get(`/api/skills/${skill.id}/versions/${skill.currentVersion.id}/download`).expect(401);
    });

    it('其他租户的 Skill 不可见、不可下载', async () => {
      const skill = await uploadOk();
      const { agent: other, tenantId: otherTenantId, rootId: otherRoot } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');
      const { agent: otherStaff } = await employeeAgent(app, prisma, otherTenantId, otherRoot, '13800000002');

      for (const agent of [other, otherStaff]) {
        expect((await agent.get('/api/skills').expect(200)).body).toEqual([]);
        await agent.get(`/api/skills/${skill.id}`).expect(404);
        await download(agent, skill.id, skill.currentVersion.id).expect(404);
      }
    });

    it('版本号与 Skill 对不上时 404', async () => {
      const a = await uploadOk('skill-a');
      const b = await uploadOk('skill-b');
      await download(employee, a.id, b.currentVersion.id).expect(404);
      await download(employee, a.id, 'not-exist').expect(404);
      await employee.get('/api/skills/not-exist').expect(404);
    });

    it('超管删除 Skill 时，一并删除版本、审核记录与私有包文件', async () => {
      const skill = await uploadOk();
      const { storageKey } = await prisma.skillVersion.findUniqueOrThrow({ where: { id: skill.currentVersion.id } });
      const superAdmin = await superAdminAgent(app, prisma);

      await superAdmin.delete(`/api/admin/skills/${skill.id}`).expect(204);

      expect(await prisma.skill.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.skillVersion.count({ where: { skillId: skill.id } })).toBe(0);
      expect(await prisma.skillReviewRecord.count({ where: { skillId: skill.id } })).toBe(0);
      expect(privateFiles()).not.toContain(storageKey);
    });

    it('被停用的员工不能再浏览', async () => {
      await uploadOk();
      await prisma.employee.updateMany({ where: { tenantId, isTenantAdmin: false }, data: { status: 'disabled' } });
      await employee.get('/api/skills').expect(403);
    });
  });
  function uploadVersion(skillId: string, zip: Buffer, version: string | null, as = admin) {
    const req = as.post(`/api/skills/${skillId}/versions`).attach('file', zip, 'skill.zip');
    return version === null ? req : req.field('version', version);
  }

  async function versionFile(as: TestAgent, skillId: string, versionId: string, name = 'pdf-tools') {
    const res = await download(as, skillId, versionId).expect(200);
    return strFromU8(unzipSync(res.body)[`${name}/VERSION.txt`]);
  }

  describe('上传新版本', () => {
    it('租户管理员为已有 Skill 上传新版本：成为当前版本，列表、详情、默认下载都切换到新版本，并记 publish_direct', async () => {
      const skill = await uploadOk('pdf-tools', '1.0.0');

      const res = await uploadVersion(skill.id, versionZip('pdf-tools', 'v1.1.0'), '1.1.0').expect(201);

      const detail: SkillDetail = res.body;
      expect(detail.currentVersion).toMatchObject({ version: '1.1.0', description: 'pdf-tools v1.1.0', uploaderName: '甲公司管理员' });
      expect(detail.versions.map((v) => v.version)).toEqual(['1.1.0', '1.0.0']);
      expect(detail.highestVersion).toBe('1.1.0');
      const list: SkillSummary[] = (await employee.get('/api/skills').expect(200)).body;
      expect(list[0].currentVersion.version).toBe('1.1.0');
      expect(await versionFile(employee, skill.id, detail.currentVersion.id)).toBe('v1.1.0');
      const records = await prisma.skillReviewRecord.findMany({ where: { versionId: detail.currentVersion.id } });
      expect(records).toEqual([expect.objectContaining({ action: 'publish_direct' })]);
    });

    it('上传新版本的包同样支持 SKILL.md 在压缩包根目录', async () => {
      const skill = await uploadOk('pdf-tools', '1.0.0');
      const zip = zipOf({ 'SKILL.md': skillMd('pdf-tools'), 'VERSION.txt': 'root' });
      await uploadVersion(skill.id, zip, '1.0.1').expect(201);
    });

    it('版本号按数值比较：1.10.0 大于 1.9.0', async () => {
      const skill = await uploadOk('pdf-tools', '1.9.0');
      const res = await uploadVersion(skill.id, versionZip('pdf-tools', 'v1.10.0'), '1.10.0').expect(201);
      expect(res.body.currentVersion.version).toBe('1.10.0');
    });

    it.each([
      ['等于最高版本', '1.2.0'],
      ['小于最高版本', '1.1.9'],
      ['主版本更小', '0.9.9'],
    ])('版本号%s被拒绝', async (_case, version) => {
      const skill = await uploadOk('pdf-tools', '1.2.0');
      const res = await uploadVersion(skill.id, versionZip('pdf-tools', version), version).expect(400);
      expect(res.body.message).toBe('版本号必须大于已有的最高版本 1.2.0');
    });

    it('非正式版本（草稿）计入最高版本、不出现在版本历史；存在时不能再上传新版本', async () => {
      const skill = await uploadOk('pdf-tools', '1.0.0');
      const published = await prisma.skillVersion.findUniqueOrThrow({ where: { id: skill.currentVersion.id } });
      const { id: _id, uploadedAt: _at, downloadCount: _dc, ...rest } = published;
      await prisma.skillVersion.create({ data: { ...rest, major: 2, minor: 0, patch: 0, version: '2.0.0', status: 'draft' } });

      const detail: SkillDetail = (await admin.get(`/api/skills/${skill.id}`).expect(200)).body;
      expect(detail).toMatchObject({ highestVersion: '2.0.0', currentVersion: { version: '1.0.0' } });
      expect(detail.versions.map((v) => v.version)).toEqual(['1.0.0']);

      expect(detail.workingVersion).toMatchObject({ version: '2.0.0', status: 'draft' });
      const res = await uploadVersion(skill.id, versionZip('pdf-tools', 'x'), '3.0.0').expect(409);
      expect(res.body.message).toBe('该 Skill 已有未成为正式的版本 2.0.0（草稿），请先处理后再上传新版本');
    });

    it('版本号格式错误或缺失被拒绝', async () => {
      const skill = await uploadOk();
      expect((await uploadVersion(skill.id, versionZip('pdf-tools', 'x'), '2.0').expect(400)).body.message).toBe(SKILL_VERSION_FORMAT_MESSAGE);
      expect((await uploadVersion(skill.id, versionZip('pdf-tools', 'x'), null).expect(400)).body.message).toBe('请填写版本号');
    });

    it('新版本 SKILL.md 的 name 与 Skill 不一致被拒绝', async () => {
      const skill = await uploadOk('pdf-tools');
      const res = await uploadVersion(skill.id, versionZip('pdf-toolkit', 'x'), '1.0.1').expect(400);
      expect(res.body.message).toBe('新版本 SKILL.md 的 name「pdf-toolkit」与 Skill 名称「pdf-tools」不一致');
    });

    it('包不合法（缺 SKILL.md）被拒绝，且不在私有存储里留下文件', async () => {
      const skill = await uploadOk();
      const before = privateFiles();
      const res = await uploadVersion(skill.id, zipOf({ 'pdf-tools/readme.md': 'x' }), '1.0.1').expect(400);
      expect(res.body.message).toBe('根目录（或唯一的顶层文件夹）中缺少 SKILL.md');
      await uploadVersion(skill.id, versionZip('pdf-tools', 'x'), '1.0.0').expect(400);
      expect(privateFiles().sort()).toEqual(before.sort());
    });

    it('未选择文件被拒绝', async () => {
      const skill = await uploadOk();
      const res = await admin.post(`/api/skills/${skill.id}/versions`).field('version', '1.0.1').expect(400);
      expect(res.body.message).toBe('请选择要上传的 Skill 文件夹');
    });

    it('不是所有者的普通员工不能上传新版本', async () => {
      const skill = await uploadOk();
      const res = await uploadVersion(skill.id, versionZip('pdf-tools', 'x'), '1.0.1', employee).expect(403);
      expect(res.body.message).toBe('只有该 Skill 的所有者和租户管理员可以上传新版本');
    });

    it('所有者已不是租户管理员时，上传的新版本按员工身份默认提交审核', async () => {
      const skill = await uploadOk();
      await prisma.employee.updateMany({ where: { tenantId, isTenantAdmin: true }, data: { isTenantAdmin: false } });
      const res = await uploadVersion(skill.id, versionZip('pdf-tools', 'x'), '1.0.1').expect(201);
      expect(res.body).toMatchObject({ currentVersion: { version: '1.0.0' }, workingVersion: { version: '1.0.1', status: 'pending' } });
    });

    it('其他租户的管理员看不到这个 Skill（404）；超管不能上传（403）', async () => {
      const skill = await uploadOk();
      const { agent: other } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');
      await uploadVersion(skill.id, versionZip('pdf-tools', 'x'), '1.0.1', other).expect(404);
      const superAdmin = await superAdminAgent(app, prisma);
      await uploadVersion(skill.id, versionZip('pdf-tools', 'x'), '1.0.1', superAdmin).expect(403);
    });

    it('同时上传同一个版本号，只有一个成功', async () => {
      const skill = await uploadOk();
      const results = await Promise.all([1, 2, 3].map(() => uploadVersion(skill.id, versionZip('pdf-tools', 'race'), '1.0.1')));
      // 锁住 Skill 行串行化：后到者看到 1.0.1 已存在，按「版本号必须大于最高版本」拒绝
      expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
      expect(await prisma.skillVersion.count({ where: { skillId: skill.id } })).toBe(2);
    });
  });

  describe('版本历史与下载次数', () => {
    it('详情页按版本号从新到旧列出所有正式版本，任一版本都能下载到对应内容', async () => {
      const skill = await uploadOk('pdf-tools', '1.0.0');
      await uploadVersion(skill.id, versionZip('pdf-tools', 'v1.0.1'), '1.0.1').expect(201);
      await uploadVersion(skill.id, versionZip('pdf-tools', 'v2.0.0'), '2.0.0').expect(201);

      const detail: SkillDetail = (await employee.get(`/api/skills/${skill.id}`).expect(200)).body;

      expect(detail.versions.map((v) => v.version)).toEqual(['2.0.0', '1.0.1', '1.0.0']);
      const old = detail.versions.find((v) => v.version === '1.0.1')!;
      expect(await versionFile(employee, skill.id, old.id)).toBe('v1.0.1');
      const res = await download(employee, skill.id, old.id).expect(200);
      expect(res.headers['content-disposition']).toBe('attachment; filename="pdf-tools-1.0.1.zip"');
    });

    it('下载次数按版本累加，只计数', async () => {
      const skill = await uploadOk('pdf-tools', '1.0.0');
      const v2: SkillDetail = (await uploadVersion(skill.id, versionZip('pdf-tools', 'v2'), '2.0.0').expect(201)).body;
      const [newId, oldId] = v2.versions.map((v) => v.id);

      await download(employee, skill.id, oldId).expect(200);
      await download(admin, skill.id, oldId).expect(200);
      await download(employee, skill.id, newId).expect(200);

      const detail: SkillDetail = (await employee.get(`/api/skills/${skill.id}`).expect(200)).body;
      expect(detail.versions.map((v) => [v.version, v.downloadCount])).toEqual([['2.0.0', 1], ['1.0.0', 2]]);
      expect(detail.currentVersion.downloadCount).toBe(1);
      const list: SkillSummary[] = (await employee.get('/api/skills').expect(200)).body;
      expect(list[0].currentVersion.downloadCount).toBe(1);
    });

    it('下载失败（版本不存在）不计数', async () => {
      const skill = await uploadOk();
      await download(employee, skill.id, 'not-exist').expect(404);
      const detail: SkillDetail = (await employee.get(`/api/skills/${skill.id}`).expect(200)).body;
      expect(detail.currentVersion.downloadCount).toBe(0);
    });
  });
});
