import type { NestExpressApplication } from '@nestjs/platform-express';
import { SKILL_CATEGORY_PRESETS, type SkillCategoryItem, type SkillDetail, type SkillManageRow, type SkillSummary } from '@skill-hub/shared';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedSuperAdmin } from './users';
import { createTestApp } from './app';
import { resetDatabase } from './reset-database';
import { skillFolderZip } from './skill-zips';
import { employeeAgent, superAdminAgent, tenantAdminAgent } from './users';

/** Skill 分类（#20）：租户管理员维护分类；上传时可选；所有者与管理员可修改；目录与管理视图按分类筛选。 */
describe('Skill 分类', () => {
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
    owner = (await employeeAgent(app, prisma, tenantId, rootId, '13800000001', '李雷')).agent;
    other = (await employeeAgent(app, prisma, tenantId, rootId, '13800000002', '韩梅梅')).agent;
  });

  afterAll(async () => {
    await app.close();
  });

  const listCategories = async (as: TestAgent): Promise<SkillCategoryItem[]> => (await as.get('/api/skills/categories').expect(200)).body;
  const addCategory = async (name: string): Promise<string> => {
    const list: SkillCategoryItem[] = (await admin.post('/api/skills/categories').send({ name }).expect(201)).body;
    return list.find((c) => c.name === name.trim())!.id;
  };

  /** 员工李雷上传并由管理员通过；categoryId 随上传表单提交 */
  async function publishedSkill(name: string, categoryId?: string, as = owner): Promise<SkillDetail> {
    let req = as.post('/api/skills').attach('file', skillFolderZip(name), 'skill.zip').field('version', '1.0.0');
    if (categoryId !== undefined) req = req.field('categoryId', categoryId);
    const created: SkillDetail = (await req.expect(201)).body;
    if (created.workingVersion) await admin.post(`/api/skills/${created.id}/versions/${created.workingVersion.id}/approve`).expect(204);
    return (await admin.get(`/api/skills/${created.id}`).expect(200)).body;
  }
  const catalog = async (as: TestAgent, query = ''): Promise<string[]> => ((await as.get(`/api/skills${query}`).expect(200)).body as SkillSummary[]).map((s) => s.name);
  const manage = async (query = ''): Promise<string[]> => ((await admin.get(`/api/skills/manage${query}`).expect(200)).body as SkillManageRow[]).map((s) => s.name);

  describe('分类管理（租户管理员）', () => {
    it('新增：去首尾空格，按创建顺序列出，管理员看到每个分类的 Skill 数，员工只看到名称', async () => {
      const rd = await addCategory(' 研发 ');
      await addCategory('办公');
      await publishedSkill('pdf-tools', rd);

      expect(await listCategories(admin)).toEqual([
        { id: rd, name: '研发', skillCount: 1 },
        { id: expect.any(String), name: '办公', skillCount: 0 },
      ]);
      expect((await listCategories(owner)).map((c) => [c.name, c.skillCount])).toEqual([
        ['研发', null],
        ['办公', null],
      ]);
    });

    it('租户内重名返回 409；名称为空或超过 20 字返回 400', async () => {
      await addCategory('研发');
      expect((await admin.post('/api/skills/categories').send({ name: '研发' }).expect(409)).body.message).toBe('分类「研发」已存在');
      expect((await admin.post('/api/skills/categories').send({ name: '  ' }).expect(400)).body.message).toBe('请填写分类名称');
      expect((await admin.post('/api/skills/categories').send({ name: '类'.repeat(21) }).expect(400)).body.message).toBe('分类名称不能超过 20 个字');
    });

    it('一键添加常用分类：只补上还没有的，重复调用无副作用', async () => {
      await addCategory('研发');
      await addCategory('我们自己的');

      const first: SkillCategoryItem[] = (await admin.post('/api/skills/categories/presets').expect(201)).body;
      const again: SkillCategoryItem[] = (await admin.post('/api/skills/categories/presets').expect(201)).body;

      expect(first.map((c) => c.name)).toEqual(['研发', '我们自己的', ...SKILL_CATEGORY_PRESETS.filter((n) => n !== '研发')]);
      expect(again).toEqual(first);
    });

    it('改名：立即反映到 Skill 上；改成已有名称 409；不存在 404', async () => {
      const rd = await addCategory('研发');
      await addCategory('办公');
      const skill = await publishedSkill('pdf-tools', rd);

      await admin.patch(`/api/skills/categories/${rd}`).send({ name: '研发中心' }).expect(200);

      expect((await owner.get(`/api/skills/${skill.id}`).expect(200)).body.category).toEqual({ id: rd, name: '研发中心' });
      await admin.patch(`/api/skills/categories/${rd}`).send({ name: '办公' }).expect(409);
      await admin.patch('/api/skills/categories/not-exist').send({ name: 'x' }).expect(404);
    });

    it('删除：使用它的 Skill 变为未分类，Skill 本身不受影响', async () => {
      const rd = await addCategory('研发');
      const skill = await publishedSkill('pdf-tools', rd);

      await admin.delete(`/api/skills/categories/${rd}`).expect(204);

      const detail: SkillDetail = (await owner.get(`/api/skills/${skill.id}`).expect(200)).body;
      expect(detail.category).toBeNull();
      expect(await listCategories(admin)).toEqual([]);
      await admin.delete(`/api/skills/categories/${rd}`).expect(404);
    });

    it('普通员工不能新增、改名、删除分类，也不能一键添加', async () => {
      const rd = await addCategory('研发');
      await owner.post('/api/skills/categories').send({ name: '办公' }).expect(403);
      await owner.post('/api/skills/categories/presets').expect(403);
      await owner.patch(`/api/skills/categories/${rd}`).send({ name: '改' }).expect(403);
      await owner.delete(`/api/skills/categories/${rd}`).expect(403);
      expect((await listCategories(admin)).map((c) => c.name)).toEqual(['研发']);
    });
  });

  describe('上传时选择分类', () => {
    it('可选可不选；选了的 Skill 在列表、详情、管理视图中带上分类', async () => {
      const rd = await addCategory('研发');
      const withCategory = await publishedSkill('pdf-tools', rd);
      const without = await publishedSkill('xlsx-tools');
      const emptyField = await publishedSkill('docx-tools', '');

      expect(withCategory.category).toEqual({ id: rd, name: '研发' });
      expect(without.category).toBeNull();
      expect(emptyField.category).toBeNull();
      const list: SkillSummary[] = (await other.get('/api/skills').expect(200)).body;
      expect(list.find((s) => s.name === 'pdf-tools')!.category).toEqual({ id: rd, name: '研发' });
      const rows: SkillManageRow[] = (await admin.get('/api/skills/manage').expect(200)).body;
      expect(rows.find((s) => s.name === 'xlsx-tools')!.category).toBeNull();
    });

    it('不存在或属于其他租户的分类被拒，且不会留下 Skill', async () => {
      const { agent: otherAdmin } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');
      const foreign = ((await otherAdmin.post('/api/skills/categories').send({ name: '研发' }).expect(201)).body as SkillCategoryItem[])[0].id;

      for (const categoryId of [foreign, 'not-exist']) {
        const res = await owner.post('/api/skills').attach('file', skillFolderZip('pdf-tools'), 'skill.zip').field('version', '1.0.0').field('categoryId', categoryId).expect(400);
        expect(res.body.message).toBe('所选分类不存在，请刷新后重试');
      }
      expect(await prisma.skill.count()).toBe(0);
    });

    it('上传新版本不改变分类', async () => {
      const rd = await addCategory('研发');
      const skill = await publishedSkill('pdf-tools', rd);

      await owner.post(`/api/skills/${skill.id}/versions`).attach('file', skillFolderZip('pdf-tools'), 'skill.zip').field('version', '1.0.1').expect(201);

      expect((await owner.get(`/api/skills/${skill.id}`).expect(200)).body.category).toEqual({ id: rd, name: '研发' });
    });
  });

  describe('修改分类', () => {
    const setCategory = (as: TestAgent, skillId: string, categoryId: string | null) => as.patch(`/api/skills/${skillId}/category`).send({ categoryId });

    it('所有者可设置、修改、清空，立即生效并留下「修改分类」记录；与原分类相同时不记录', async () => {
      const rd = await addCategory('研发');
      const office = await addCategory('办公');
      const skill = await publishedSkill('pdf-tools');

      expect((await setCategory(owner, skill.id, rd).expect(200)).body.category).toEqual({ id: rd, name: '研发' });
      await setCategory(owner, skill.id, office).expect(200);
      await setCategory(owner, skill.id, office).expect(200);
      expect((await setCategory(owner, skill.id, null).expect(200)).body.category).toBeNull();

      const records = await prisma.skillReviewRecord.findMany({ where: { skillId: skill.id, action: 'change_category' }, orderBy: { createdAt: 'asc' } });
      expect(records.map((r) => r.comment)).toEqual(['未分类 → 研发', '研发 → 办公', '办公 → 未分类']);
    });

    it('租户管理员可以调整任意 Skill 的分类', async () => {
      const rd = await addCategory('研发');
      const skill = await publishedSkill('pdf-tools');
      expect((await setCategory(admin, skill.id, rd).expect(200)).body.category).toEqual({ id: rd, name: '研发' });
    });

    it('其他员工不能修改（看得到 403，看不到 404）；其他租户的分类被拒；缺少 categoryId 400', async () => {
      const rd = await addCategory('研发');
      const skill = await publishedSkill('pdf-tools');
      expect((await setCategory(other, skill.id, rd).expect(403)).body.message).toBe('只有该 Skill 的所有者和租户管理员可以修改分类');

      await owner.patch(`/api/skills/${skill.id}/visibility`).send({ visibility: 'private' }).expect(200);
      await setCategory(other, skill.id, rd).expect(404);

      const { agent: otherAdmin } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');
      const foreign = ((await otherAdmin.post('/api/skills/categories').send({ name: '研发' }).expect(201)).body as SkillCategoryItem[])[0].id;
      await setCategory(owner, skill.id, foreign).expect(400);
      await otherAdmin.patch(`/api/skills/${skill.id}/category`).send({ categoryId: foreign }).expect(404);
      await owner.patch(`/api/skills/${skill.id}/category`).send({}).expect(400);
    });
  });

  describe('按分类筛选', () => {
    it('目录按分类筛选，仍受可见性约束', async () => {
      const rd = await addCategory('研发');
      const office = await addCategory('办公');
      await publishedSkill('pdf-tools', rd);
      await publishedSkill('xlsx-tools', office);
      const hidden = await publishedSkill('secret-tools', rd);
      await owner.patch(`/api/skills/${hidden.id}/visibility`).send({ visibility: 'private' }).expect(200);

      expect(await catalog(other, `?categoryId=${rd}`)).toEqual(['pdf-tools']);
      expect(await catalog(owner, `?categoryId=${rd}`)).toEqual(['pdf-tools', 'secret-tools']);
      expect(await catalog(other, `?categoryId=${office}`)).toEqual(['xlsx-tools']);
    });

    it('管理视图可筛选「未分类」，并可与其他条件组合', async () => {
      const rd = await addCategory('研发');
      await publishedSkill('pdf-tools', rd);
      await publishedSkill('xlsx-tools');
      const unlisted = await publishedSkill('docx-tools');
      await admin.post(`/api/skills/${unlisted.id}/unlist`).expect(204);

      expect(await manage('?categoryId=none')).toEqual(['docx-tools', 'xlsx-tools']);
      expect(await manage('?categoryId=none&unlisted=true')).toEqual(['docx-tools']);
      expect(await manage(`?categoryId=${rd}`)).toEqual(['pdf-tools']);
    });
  });

  describe('隔离与超管', () => {
    it('分类按租户隔离：其他租户的管理员看不到、改不了、删不掉', async () => {
      const rd = await addCategory('研发');
      const { agent: otherAdmin } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');

      expect(await listCategories(otherAdmin)).toEqual([]);
      await otherAdmin.patch(`/api/skills/categories/${rd}`).send({ name: '改' }).expect(404);
      await otherAdmin.delete(`/api/skills/categories/${rd}`).expect(404);
      // 同名分类在不同租户互不冲突
      await otherAdmin.post('/api/skills/categories').send({ name: '研发' }).expect(201);
    });

    it('超管在租户 Skill 列表与详情中看到分类（只读），不能调用租户分类接口', async () => {
      const rd = await addCategory('研发');
      const skill = await publishedSkill('pdf-tools', rd);
      const sa = await superAdminAgent(app, prisma);

      const rows: SkillManageRow[] = (await sa.get(`/api/admin/tenants/${tenantId}/skills`).expect(200)).body;
      expect(rows[0].category).toEqual({ id: rd, name: '研发' });
      expect((await sa.get(`/api/admin/skills/${skill.id}`).expect(200)).body.category).toEqual({ id: rd, name: '研发' });
      await sa.get('/api/skills/categories').expect(403);
      await sa.post('/api/skills/categories').send({ name: 'x' }).expect(403);
    });

    it('演示版不允许删除租户或其分类数据', async () => {
      await addCategory('研发');
      const sa = await superAdminAgent(app, prisma);
      await sa.post(`/api/admin/tenants/${tenantId}/disable`).expect(404);
      await sa.delete(`/api/admin/tenants/${tenantId}`).expect(404);
      expect(await prisma.skillCategory.count()).toBe(1);
    });

    it('未登录 401', async () => {
      await request(app.getHttpServer()).get('/api/skills/categories').expect(401);
    });
  });
});
