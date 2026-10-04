import type { NestExpressApplication } from '@nestjs/platform-express';
import type { SkillDetail, SkillManageRow, SkillSummary } from '@skill-hub/shared';
import { existsSync, readdirSync } from 'node:fs';
import TestAgent from 'supertest/lib/agent';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedSuperAdmin } from './users';
import { createTestApp } from './app';
import { resetDatabase } from './reset-database';
import { binary, skillMd, zipOf } from './skill-zips';
import { employeeAgent, superAdminAgent, tenantAdminAgent } from './users';

const PRIVATE_DIR = process.env.PRIVATE_UPLOAD_DIR!;

describe('Skill 治理：下架、删除、超管视图、搜索筛选', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;
  let owner: TestAgent;
  let other: TestAgent;
  let superAdmin: TestAgent;
  let tenantId: string;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedSuperAdmin(prisma);
    let rootId: string;
    ({ agent: admin, tenantId, rootId } = await tenantAdminAgent(app, prisma, '甲公司', '13900000001'));
    ({ agent: owner, employeeId: ownerId } = await employeeAgent(app, prisma, tenantId, rootId, '13800000001', '李雷'));
    ({ agent: other, employeeId: otherId } = await employeeAgent(app, prisma, tenantId, rootId, '13800000002', '韩梅梅'));
    superAdmin = await superAdminAgent(app, prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const pkg = (name: string, description: string, marker = 'v') => zipOf({ [`${name}/SKILL.md`]: skillMd(name, description), [`${name}/VERSION.txt`]: marker });

  /** 李雷上传并由管理员通过，得到正式的 Skill */
  async function staffSkill(name = 'pdf-tools', description = '提取 PDF 文字与表格'): Promise<SkillDetail> {
    const created: SkillDetail = (await owner.post('/api/skills').attach('file', pkg(name, description), 'skill.zip').field('version', '1.0.0').expect(201)).body;
    await admin.post(`/api/skills/${created.id}/versions/${created.workingVersion!.id}/approve`).expect(204);
    return (await owner.get(`/api/skills/${created.id}`).expect(200)).body;
  }
  /** 管理员给 Skill 发布新版本 */
  async function adminVersion(skillId: string, version: string, name = 'pdf-tools'): Promise<SkillDetail> {
    return (await admin.post(`/api/skills/${skillId}/versions`).attach('file', pkg(name, `${name} ${version}`, version), 'skill.zip').field('version', version).expect(201)).body;
  }
  const names = async (as: TestAgent, query = '') => ((await as.get(`/api/skills${query}`).expect(200)).body as SkillSummary[]).map((s) => s.name);
  const download = (as: TestAgent, skill: SkillDetail, versionId = skill.currentVersion!.id) => as.get(`/api/skills/${skill.id}/versions/${versionId}/download`).buffer(true).parse(binary);
  const privateFiles = () => (existsSync(PRIVATE_DIR) ? readdirSync(PRIVATE_DIR) : []);
  const storageKeys = async (skillId: string) => (await prisma.skillVersion.findMany({ where: { skillId } })).map((v) => v.storageKey);

  describe('下架 / 上架', () => {
    it('租户管理员下架：其他员工立即看不到也下载不了，所有者与管理员不受影响；上架后恢复；都有记录', async () => {
      const skill = await staffSkill();

      await admin.post(`/api/skills/${skill.id}/unlist`).expect(204);

      expect(await names(other)).toEqual([]);
      await other.get(`/api/skills/${skill.id}`).expect(404);
      await download(other, skill).expect(404);
      expect((await owner.get(`/api/skills/${skill.id}`).expect(200)).body).toMatchObject({ unlisted: true });
      await download(owner, skill).expect(200);
      await download(admin, skill).expect(200);
      expect(await names(owner)).toEqual(['pdf-tools']); // 所有者自己的目录里仍有

      await admin.post(`/api/skills/${skill.id}/relist`).expect(204);
      expect(await names(other)).toEqual(['pdf-tools']);
      await download(other, skill).expect(200);

      const records = (await admin.get(`/api/skills/${skill.id}`).expect(200)).body.reviewRecords;
      expect(records.slice(0, 2).map((r: { action: string; actorName: string }) => [r.action, r.actorName])).toEqual([
        ['relist', '甲公司管理员'],
        ['unlist', '甲公司管理员'],
      ]);
    });

    it('版本和文件全部保留；重复下架 / 上架被拒绝；员工（含所有者）不能下架', async () => {
      const skill = await staffSkill();
      const keys = await storageKeys(skill.id);
      await admin.post(`/api/skills/${skill.id}/unlist`).expect(204);
      expect(privateFiles()).toEqual(expect.arrayContaining(keys));
      expect((await admin.post(`/api/skills/${skill.id}/unlist`).expect(409)).body.message).toBe('这个 Skill 已经下架');
      await admin.post(`/api/skills/${skill.id}/relist`).expect(204);
      expect((await admin.post(`/api/skills/${skill.id}/relist`).expect(409)).body.message).toBe('这个 Skill 没有下架');
      await owner.post(`/api/skills/${skill.id}/unlist`).expect(403);
    });
  });

  describe('删除', () => {
    it('所有者删除自己的整个 Skill：版本、审核记录与存储文件一并清理', async () => {
      const skill = await staffSkill();
      const keys = await storageKeys(skill.id);

      await owner.delete(`/api/skills/${skill.id}`).expect(204);

      expect(await prisma.skill.count({ where: { id: skill.id } })).toBe(0);
      expect(await prisma.skillVersion.count({ where: { skillId: skill.id } })).toBe(0);
      expect(await prisma.skillReviewRecord.count({ where: { skillId: skill.id } })).toBe(0);
      for (const k of keys) expect(privateFiles()).not.toContain(k);
    });

    it('租户管理员可以删除任意 Skill；其他员工不能（看得到 403，看不到 404）', async () => {
      const skill = await staffSkill();
      expect((await other.delete(`/api/skills/${skill.id}`).expect(403)).body.message).toBe('只有该 Skill 的所有者和租户管理员可以删除');
      await admin.post(`/api/skills/${skill.id}/unlist`).expect(204);
      await other.delete(`/api/skills/${skill.id}`).expect(404);
      await admin.delete(`/api/skills/${skill.id}`).expect(204);
    });

    it('租户管理员可以删除任意单个版本：当前版本随之回退，该版本的文件被清理，审核记录保留', async () => {
      const skill = await staffSkill();
      const v2 = await adminVersion(skill.id, '1.1.0');
      const v2Id = v2.currentVersion!.id;
      const v2Key = (await prisma.skillVersion.findUniqueOrThrow({ where: { id: v2Id } })).storageKey;

      await admin.delete(`/api/skills/${skill.id}/versions/${v2Id}`).expect(204);

      const after: SkillDetail = (await other.get(`/api/skills/${skill.id}`).expect(200)).body;
      expect(after.currentVersion!.version).toBe('1.0.0');
      expect(privateFiles()).not.toContain(v2Key);
      expect(await prisma.skillReviewRecord.count({ where: { skillId: skill.id, versionId: null, action: 'publish_direct' } })).toBe(1);
    });

    it('所有者不能删除正式版本；删除最后一个版本时 Skill 一并删除', async () => {
      const skill = await staffSkill();
      expect((await owner.delete(`/api/skills/${skill.id}/versions/${skill.currentVersion!.id}`).expect(403)).body.message).toBe('正式版本只有租户管理员可以删除');
      await admin.delete(`/api/skills/${skill.id}/versions/${skill.currentVersion!.id}`).expect(204);
      expect(await prisma.skill.count({ where: { id: skill.id } })).toBe(0);
    });

    it('租户管理员也能删除员工审核中的版本', async () => {
      const skill = await staffSkill();
      const pending: SkillDetail = (await owner.post(`/api/skills/${skill.id}/versions`).attach('file', pkg('pdf-tools', 'x'), 'skill.zip').field('version', '1.1.0').expect(201)).body;
      await admin.delete(`/api/skills/${skill.id}/versions/${pending.workingVersion!.id}`).expect(204);
      expect((await owner.get(`/api/skills/${skill.id}`).expect(200)).body.workingVersion).toBeNull();
    });
  });

  describe('超管', () => {
    it('按租户查看全部 Skill（含还没有正式版本、已下架的）与详情', async () => {
      const published = await staffSkill();
      await owner.post('/api/skills').attach('file', pkg('draft-only', '只有草稿'), 'skill.zip').field('version', '0.1.0').field('mode', 'draft').expect(201);
      await admin.post(`/api/skills/${published.id}/unlist`).expect(204);

      const rows: SkillManageRow[] = (await superAdmin.get(`/api/admin/tenants/${tenantId}/skills`).expect(200)).body;
      expect(rows.map((r) => [r.name, r.currentVersion?.version ?? null, r.workingStatus, r.unlisted, r.ownerName])).toEqual([
        ['draft-only', null, 'draft', false, '李雷'],
        ['pdf-tools', '1.0.0', null, true, '李雷'],
      ]);

      const detail: SkillDetail = (await superAdmin.get(`/api/admin/skills/${published.id}`).expect(200)).body;
      expect(detail).toMatchObject({ name: 'pdf-tools', unlisted: true, isOwner: false, currentVersion: { version: '1.0.0' } });
      expect(detail.reviewRecords.map((r) => r.action)).toEqual(['unlist', 'approve', 'submit']);
    });

    it('能下载任意版本（不计入下载次数）、下架、上架、删除；记录的操作人是超管', async () => {
      const skill = await staffSkill();
      const res = await superAdmin.get(`/api/admin/skills/${skill.id}/versions/${skill.currentVersion!.id}/download`).buffer(true).parse(binary).expect(200);
      expect(res.headers['content-disposition']).toBe('attachment; filename="pdf-tools-1.0.0.zip"');
      expect((await prisma.skillVersion.findUniqueOrThrow({ where: { id: skill.currentVersion!.id } })).downloadCount).toBe(0);

      await superAdmin.post(`/api/admin/skills/${skill.id}/unlist`).expect(204);
      expect(await names(other)).toEqual([]);
      await superAdmin.post(`/api/admin/skills/${skill.id}/relist`).expect(204);
      expect(await names(other)).toEqual(['pdf-tools']);
      const records = (await superAdmin.get(`/api/admin/skills/${skill.id}`).expect(200)).body.reviewRecords;
      expect(records[0]).toMatchObject({ action: 'relist', actorName: '超级管理员' });

      const keys = await storageKeys(skill.id);
      await superAdmin.delete(`/api/admin/skills/${skill.id}`).expect(204);
      expect(await prisma.skill.count({ where: { id: skill.id } })).toBe(0);
      for (const k of keys) expect(privateFiles()).not.toContain(k);
    });

    it('上传与审核接口拒绝超管；租户管理员不能用超管接口；不存在 404', async () => {
      const created: SkillDetail = (await owner.post('/api/skills').attach('file', pkg('pdf-tools', 'x'), 'skill.zip').field('version', '1.0.0').expect(201)).body;
      await superAdmin.post('/api/skills').attach('file', pkg('by-super', 'x'), 'skill.zip').field('version', '1.0.0').expect(403);
      await superAdmin.post(`/api/skills/${created.id}/versions/${created.workingVersion!.id}/approve`).expect(403);
      await admin.get(`/api/admin/tenants/${tenantId}/skills`).expect(403);
      await admin.post(`/api/admin/skills/${created.id}/unlist`).expect(403);
      await superAdmin.get('/api/admin/tenants/not-exist/skills').expect(404);
      await superAdmin.get('/api/admin/skills/not-exist').expect(404);
    });
  });

  describe('搜索与筛选', () => {
    beforeEach(async () => {
      await staffSkill('pdf-tools', '提取 PDF 文字与表格');
      await staffSkill('meeting-notes', '整理会议纪要');
      // 韩梅梅上传的 Skill（管理员通过）
      const c: SkillDetail = (await other.post('/api/skills').attach('file', pkg('sql-review', '审查 SQL 性能'), 'skill.zip').field('version', '1.0.0').expect(201)).body;
      await admin.post(`/api/skills/${c.id}/versions/${c.workingVersion!.id}/approve`).expect(204);
    });

    it('员工按名称或描述搜索（不区分大小写），按上传人筛选', async () => {
      expect(await names(other, '?keyword=PDF')).toEqual(['pdf-tools']);
      expect(await names(other, `?keyword=${encodeURIComponent('纪要')}`)).toEqual(['meeting-notes']);
      expect(await names(other, `?uploaderId=${otherId}`)).toEqual(['sql-review']);
      expect(await names(other, `?uploaderId=${ownerId}&keyword=notes`)).toEqual(['meeting-notes']);
      expect(await names(other, '?keyword=不存在')).toEqual([]);
    });

    it('描述只按当前版本匹配：旧版本的描述不再命中', async () => {
      const pdf = ((await admin.get('/api/skills').expect(200)).body as SkillSummary[]).find((s) => s.name === 'pdf-tools')!;
      await admin.post(`/api/skills/${pdf.id}/versions`).attach('file', pkg('pdf-tools', '合并多个 PDF'), 'skill.zip').field('version', '1.1.0').expect(201);
      expect(await names(other, `?keyword=${encodeURIComponent('表格')}`)).toEqual([]);
      expect(await names(other, `?keyword=${encodeURIComponent('合并')}`)).toEqual(['pdf-tools']);
    });

    it('租户管理员的管理视图：另可按审核状态、可见性、是否下架筛选；员工不能访问', async () => {
      const skills = (await admin.get('/api/skills').expect(200)).body as SkillSummary[];
      const pdf = skills.find((s) => s.name === 'pdf-tools')!;
      await owner.post(`/api/skills/${pdf.id}/versions`).attach('file', pkg('pdf-tools', '新版'), 'skill.zip').field('version', '1.1.0').expect(201);
      await owner.post('/api/skills').attach('file', pkg('draft-only', '草稿'), 'skill.zip').field('version', '0.1.0').field('mode', 'draft').expect(201);
      await admin.patch(`/api/skills/${skills.find((s) => s.name === 'sql-review')!.id}/visibility`).send({ visibility: 'private' }).expect(200);
      await admin.post(`/api/skills/${skills.find((s) => s.name === 'meeting-notes')!.id}/unlist`).expect(204);

      const manage = async (q: string) => ((await admin.get(`/api/skills/manage${q}`).expect(200)).body as SkillManageRow[]).map((r) => r.name);
      expect(await manage('')).toEqual(['draft-only', 'meeting-notes', 'pdf-tools', 'sql-review']);
      expect(await manage('?status=pending')).toEqual(['pdf-tools']);
      expect(await manage('?status=draft')).toEqual(['draft-only']);
      expect(await manage('?status=published')).toEqual(['meeting-notes', 'pdf-tools', 'sql-review']);
      expect(await manage('?visibility=private')).toEqual(['sql-review']);
      expect(await manage('?unlisted=true')).toEqual(['meeting-notes']);
      expect(await manage('?unlisted=false&keyword=sql')).toEqual(['sql-review']);
      expect((await admin.get('/api/skills/manage?status=deleted').expect(400)).body.message).toBe('审核状态不正确');
      await other.get('/api/skills/manage').expect(403);

      // 超管的租户视图支持同样的筛选
      expect(((await superAdmin.get(`/api/admin/tenants/${tenantId}/skills?status=pending`).expect(200)).body as SkillManageRow[]).map((r) => r.name)).toEqual(['pdf-tools']);
    });
  });
});
