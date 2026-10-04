import type { NestExpressApplication } from '@nestjs/platform-express';
import type { SkillDetail, SkillSummary, SkillVisibilityOptions } from '@skill-hub/shared';
import TestAgent from 'supertest/lib/agent';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedSuperAdmin } from './users';
import { createTestApp } from './app';
import { resetDatabase } from './reset-database';
import { binary, skillFolderZip } from './skill-zips';
import { employeeAgent, superAdminAgent, tenantAdminAgent } from './users';

/**
 * 组织：甲公司（根）→ 研发部 → 前端组；甲公司 → 运营部。
 * 所有者李雷在根部门；小研在研发部，小前在前端组，小运在运营部。
 */
describe('Skill 可见性', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;
  let owner: TestAgent;
  let rd: TestAgent;
  let fe: TestAgent;
  let ops: TestAgent;
  let tenantId: string;
  let rootId: string;
  const dept: Record<string, string> = {};
  const emp: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedSuperAdmin(prisma);
    ({ agent: admin, tenantId, rootId } = await tenantAdminAgent(app, prisma, '甲公司', '13900000001'));
    const mk = async (parentId: string, name: string) => (await prisma.department.create({ data: { tenantId, parentId, name } })).id;
    dept.rd = await mk(rootId, '研发部');
    dept.fe = await mk(dept.rd, '前端组');
    dept.ops = await mk(rootId, '运营部');
    let r;
    r = await employeeAgent(app, prisma, tenantId, rootId, '13800000001', '李雷');
    owner = r.agent;
    emp.owner = r.employeeId;
    r = await employeeAgent(app, prisma, tenantId, dept.rd, '13800000002', '小研');
    rd = r.agent;
    emp.rd = r.employeeId;
    r = await employeeAgent(app, prisma, tenantId, dept.fe, '13800000003', '小前');
    fe = r.agent;
    emp.fe = r.employeeId;
    r = await employeeAgent(app, prisma, tenantId, dept.ops, '13800000004', '小运');
    ops = r.agent;
    emp.ops = r.employeeId;
  });

  afterAll(async () => {
    await app.close();
  });

  /** 所有者李雷（员工）新建并由管理员通过，得到一个正式的 Skill；visibility 等字段随上传表单提交 */
  async function publishedSkill(fields: Record<string, string | string[]> = {}): Promise<SkillDetail> {
    let req = owner.post('/api/skills').attach('file', skillFolderZip('pdf-tools'), 'skill.zip').field('version', '1.0.0');
    for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) req = req.field(k, one);
    const created: SkillDetail = (await req.expect(201)).body;
    await admin.post(`/api/skills/${created.id}/versions/${created.workingVersion!.id}/approve`).expect(204);
    return (await owner.get(`/api/skills/${created.id}`).expect(200)).body;
  }
  const setVisibility = (as: TestAgent, skillId: string, body: object) => as.patch(`/api/skills/${skillId}/visibility`).send(body);
  const names = async (as: TestAgent) => ((await as.get('/api/skills').expect(200)).body as SkillSummary[]).map((s) => s.name);

  /** 列表、详情、下载三处是否都能看到 */
  async function canSee(as: TestAgent, skill: SkillDetail): Promise<boolean> {
    const inList = (await names(as)).includes(skill.name);
    const detail = (await as.get(`/api/skills/${skill.id}`)).status;
    const download = (await as.get(`/api/skills/${skill.id}/versions/${skill.currentVersion!.id}/download`).buffer(true).parse(binary)).status;
    expect([inList, detail === 200, download === 200].every((x) => x === inList)).toBe(true); // 三处一致
    return inList;
  }

  describe('四种可见性', () => {
    it('默认租户可见：本租户员工都能看到', async () => {
      const skill = await publishedSkill();
      expect(skill.visibility).toEqual({ visibility: 'tenant', departments: [], employees: [] });
      for (const a of [rd, fe, ops]) expect(await canSee(a, skill)).toBe(true);
    });

    it('特定部门可见：所选部门及其下级部门的员工可见，其他部门看不到（上传时设置）', async () => {
      const skill = await publishedSkill({ visibility: 'departments', departmentIds: dept.rd });

      expect(skill.visibility).toEqual({ visibility: 'departments', departments: [{ id: dept.rd, name: '研发部' }], employees: [] });
      expect(await canSee(rd, skill)).toBe(true);
      expect(await canSee(fe, skill)).toBe(true); // 前端组是研发部的下级部门
      expect(await canSee(ops, skill)).toBe(false);
      // 所有者、租户管理员不受可见性限制
      expect(await canSee(owner, skill)).toBe(true);
      expect(await canSee(admin, skill)).toBe(true);
    });

    it('特定部门可见可以多选', async () => {
      const skill = await publishedSkill({ visibility: 'departments', departmentIds: [dept.fe, dept.ops] });
      expect(await canSee(rd, skill)).toBe(false);
      expect(await canSee(fe, skill)).toBe(true);
      expect(await canSee(ops, skill)).toBe(true);
    });

    it('特定员工可见：名单中的员工可见，所有者自动在名单中', async () => {
      const skill = await publishedSkill({ visibility: 'employees', employeeIds: emp.ops });

      expect(skill.visibility.employees.map((e) => e.name).sort()).toEqual(['小运', '李雷'].sort());
      expect(await canSee(ops, skill)).toBe(true);
      expect(await canSee(rd, skill)).toBe(false);
      expect(await canSee(owner, skill)).toBe(true);
    });

    it('仅自己可见：只有所有者（与管理员）能看到', async () => {
      const skill = await publishedSkill({ visibility: 'private' });
      for (const a of [rd, fe, ops]) expect(await canSee(a, skill)).toBe(false);
      expect(await canSee(owner, skill)).toBe(true);
      expect(await canSee(admin, skill)).toBe(true);
    });

    it('看不到的人也不能给它上传新版本（404，不暴露存在）', async () => {
      const skill = await publishedSkill({ visibility: 'private' });
      await rd.post(`/api/skills/${skill.id}/versions`).attach('file', skillFolderZip('pdf-tools'), 'skill.zip').field('version', '1.0.1').expect(404);
    });
  });

  describe('按当前组织结构实时计算', () => {
    it('员工换部门后，可见结果马上改变', async () => {
      const skill = await publishedSkill({ visibility: 'departments', departmentIds: dept.rd });
      expect(await canSee(fe, skill)).toBe(true);

      await prisma.employee.update({ where: { id: emp.fe }, data: { departmentId: dept.ops } });
      expect(await canSee(fe, skill)).toBe(false);

      await prisma.employee.update({ where: { id: emp.ops }, data: { departmentId: dept.fe } });
      expect(await canSee(ops, skill)).toBe(true);
    });

    it('所选部门被删除：自动从可见范围中去掉；一个都不剩时只有所有者和管理员能看到', async () => {
      const temp = (await prisma.department.create({ data: { tenantId, parentId: rootId, name: '临时组' } })).id;
      const skill = await publishedSkill({ visibility: 'departments', departmentIds: [temp, dept.ops] });

      await prisma.department.delete({ where: { id: temp } });
      expect((await owner.get(`/api/skills/${skill.id}`).expect(200)).body.visibility.departments).toEqual([{ id: dept.ops, name: '运营部' }]);
      expect(await canSee(ops, skill)).toBe(true);

      await setVisibility(owner, skill.id, { visibility: 'departments', departmentIds: [temp2Id()] }).expect(400); // 不存在的部门
      const only = (await prisma.department.create({ data: { tenantId, parentId: rootId, name: '临时组二' } })).id;
      await setVisibility(owner, skill.id, { visibility: 'departments', departmentIds: [only] }).expect(200);
      await prisma.department.delete({ where: { id: only } });

      const after: SkillDetail = (await owner.get(`/api/skills/${skill.id}`).expect(200)).body;
      expect(after.visibility).toEqual({ visibility: 'departments', departments: [], employees: [] });
      for (const a of [rd, fe, ops]) expect(await canSee(a, skill)).toBe(false);
      expect(await canSee(admin, skill)).toBe(true);
    });
  });

  describe('修改可见性', () => {
    it('所有者修改：立即生效，记一条修改可见性的记录，不触发重新审核', async () => {
      const skill = await publishedSkill();

      const res = await setVisibility(owner, skill.id, { visibility: 'departments', departmentIds: [dept.rd, dept.ops] }).expect(200);

      const updated: SkillDetail = res.body;
      expect(updated.visibility.departments.map((d) => d.name).sort()).toEqual(['研发部', '运营部'].sort());
      expect(updated).toMatchObject({ currentVersion: { id: skill.currentVersion!.id }, workingVersion: null });
      expect(updated.reviewRecords[0]).toMatchObject({ action: 'change_visibility', actorName: '李雷', versionId: null });
      expect(updated.reviewRecords[0].comment).toMatch(/^租户可见 → 特定部门可见：(研发部、运营部|运营部、研发部)（含下级部门）$/);
      expect(await canSee(fe, skill)).toBe(true);
      expect(await canSee(owner, skill)).toBe(true);
    });

    it('租户管理员也能修改；其他员工不能（看得到时 403，看不到时 404）', async () => {
      const skill = await publishedSkill();
      await setVisibility(admin, skill.id, { visibility: 'private' }).expect(200);
      expect(await canSee(rd, skill)).toBe(false);
      await setVisibility(rd, skill.id, { visibility: 'tenant' }).expect(404);

      await setVisibility(admin, skill.id, { visibility: 'tenant' }).expect(200);
      expect((await setVisibility(rd, skill.id, { visibility: 'private' }).expect(403)).body.message).toBe('只有该 Skill 的所有者和租户管理员可以修改可见性');
    });

    it('设置不合法被拒绝', async () => {
      const skill = await publishedSkill();
      const { tenantId: otherTenant, rootId: otherRoot } = await tenantAdminAgent(app, prisma, '乙公司', '13900000002');
      const { employeeId: outsider } = await employeeAgent(app, prisma, otherTenant, otherRoot, '13800000009');

      expect((await setVisibility(owner, skill.id, { visibility: 'everyone' }).expect(400)).body.message).toBe('可见性不正确');
      expect((await setVisibility(owner, skill.id, { visibility: 'departments' }).expect(400)).body.message).toBe('请选择可见的部门');
      expect((await setVisibility(owner, skill.id, { visibility: 'departments', departmentIds: [otherRoot] }).expect(400)).body.message).toBe('所选部门不存在');
      expect((await setVisibility(owner, skill.id, { visibility: 'employees', employeeIds: [outsider] }).expect(400)).body.message).toBe('所选员工不存在');
      // 特定员工可见可以只有自己（所有者自动在名单中）
      expect((await setVisibility(owner, skill.id, { visibility: 'employees', employeeIds: [] }).expect(200)).body.visibility.employees).toEqual([{ id: emp.owner, name: '李雷' }]);
    });

    it('上传新版本、审核通过都不改变可见性', async () => {
      const skill = await publishedSkill({ visibility: 'private' });
      const v = (await owner.post(`/api/skills/${skill.id}/versions`).attach('file', skillFolderZip('pdf-tools'), 'skill.zip').field('version', '1.1.0').expect(201)).body;
      await admin.post(`/api/skills/${skill.id}/versions/${v.workingVersion.id}/approve`).expect(204);
      expect((await owner.get(`/api/skills/${skill.id}`).expect(200)).body.visibility.visibility).toBe('private');
      expect(await canSee(rd, skill)).toBe(false);
    });
  });

  describe('不暴露看不到的 Skill', () => {
    it('新建时与看不到的 Skill 重名：提示换名称，不返回已有 Skill 的 id；看得到时才引导去上传新版本', async () => {
      const skill = await publishedSkill({ visibility: 'private' });

      const hidden = await ops.post('/api/skills').attach('file', skillFolderZip('pdf-tools'), 'skill.zip').field('version', '1.0.0').expect(409);
      expect(hidden.body).toEqual({ message: '本租户已存在名为「pdf-tools」的 Skill，请换一个名称' }); // 不含 skillId

      await setVisibility(owner, skill.id, { visibility: 'tenant' }).expect(200);
      const shown = await ops.post('/api/skills').attach('file', skillFolderZip('pdf-tools'), 'skill.zip').field('version', '1.0.0').expect(409);
      expect(shown.body).toMatchObject({ skillId: skill.id, message: '本租户已存在名为「pdf-tools」的 Skill，请到该 Skill 详情页上传新版本' });
    });
  });

  describe('可见性选项与审核链接', () => {
    it('本租户员工都能取部门树与在职员工，用于设置可见性；超管不能', async () => {
      await prisma.employee.update({ where: { id: emp.ops }, data: { status: 'disabled' } });

      const options: SkillVisibilityOptions = (await rd.get('/api/skills/visibility-options').expect(200)).body;

      expect(options.departments.map((d) => d.name).sort()).toEqual(['前端组', '研发部', '甲公司', '运营部'].sort());
      expect(options.employees.map((e) => e.name).sort()).toEqual(['小前', '小研', '李雷', '甲公司管理员'].sort());
      expect(options.employees.find((e) => e.name === '小前')).toMatchObject({ departmentName: '前端组' });
      await (await superAdminAgent(app, prisma)).get('/api/skills/visibility-options').expect(403);
    });

    it('审核链接返回可见性；看不到的员工仍无权打开', async () => {
      const created: SkillDetail = (
        await owner.post('/api/skills').attach('file', skillFolderZip('pdf-tools'), 'skill.zip').field('version', '1.0.0').field('visibility', 'departments').field('departmentIds', dept.rd).expect(201)
      ).body;
      const view = (await admin.get(`/api/skills/review-links/${created.workingVersion!.id}`).expect(200)).body;
      expect(view.visibility).toEqual({ visibility: 'departments', departments: [{ id: dept.rd, name: '研发部' }], employees: [] });
      await rd.get(`/api/skills/review-links/${created.workingVersion!.id}`).expect(403);
    });
  });
});

/** 一个格式正确但不存在的部门 id */
const temp2Id = () => '00000000-0000-4000-8000-000000000000';
