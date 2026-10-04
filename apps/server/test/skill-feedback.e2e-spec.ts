import type { NestExpressApplication } from '@nestjs/platform-express';
import type { SkillDetail, SkillFeedbackInfo } from '@skill-hub/shared';
import TestAgent from 'supertest/lib/agent';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedSuperAdmin } from './users';
import { createTestApp } from './app';
import { resetDatabase } from './reset-database';
import { versionZip } from './skill-zips';
import { employeeAgent, superAdminAgent, tenantAdminAgent } from './users';

describe('Skill 反馈', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;
  let owner: TestAgent;
  let employee: TestAgent;
  let superAdmin: TestAgent;
  let tenantId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedSuperAdmin(prisma);
    let rootId: string;
    ({ agent: admin, tenantId, rootId } = await tenantAdminAgent(app, prisma, '甲公司', '13900000001'));
    ({ agent: owner } = await employeeAgent(app, prisma, tenantId, rootId, '13800000001', '李雷'));
    ({ agent: employee } = await employeeAgent(app, prisma, tenantId, rootId, '13800000002', '韩梅梅'));
    superAdmin = await superAdminAgent(app, prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function create(as: TestAgent, name: string, version = '1.0.0') {
    return as.post('/api/skills').attach('file', versionZip(name, `v${version}`), 'skill.zip').field('version', version);
  }

  async function publishedSkill(): Promise<SkillDetail> {
    const skill: SkillDetail = (await create(admin, 'pdf-tools').expect(201)).body;
    const staff = await prisma.employee.findFirstOrThrow({ where: { tenantId, user: { phone: '13800000001' } } });
    await prisma.skill.update({ where: { id: skill.id }, data: { ownerEmployeeId: staff.id } });
    return skill;
  }

  const feedbacks = (as: TestAgent, skillId: string, status?: string) => {
    const url = `/api/skills/${skillId}/feedbacks`;
    return status ? as.get(url).query({ status }) : as.get(url);
  };

  const createFeedback = (as: TestAgent, skillId: string, title: string, description: string, contextVersionId?: string) => {
    const body: Record<string, string> = { title, description };
    if (contextVersionId) body.contextVersionId = contextVersionId;
    return as.post(`/api/skills/${skillId}/feedbacks`).send(body);
  };

  const updateFeedback = (as: TestAgent, skillId: string, feedbackId: string, status: string, resolution?: string) => {
    const body: Record<string, string> = { status };
    if (resolution) body.resolution = resolution;
    return as.patch(`/api/skills/${skillId}/feedbacks/${feedbackId}`).send(body);
  };

  const pendingCount = (as: TestAgent, skillId: string) => as.get(`/api/skills/${skillId}/feedbacks/pending-count`);

  describe('提交反馈', () => {
    it('能访问 Skill 的租户成员可以提交反馈', async () => {
      const skill = await publishedSkill();
      const res = await createFeedback(employee, skill.id, '发现问题', '使用时报错').expect(201);
      expect(res.body).toMatchObject({
        skillId: skill.id,
        title: '发现问题',
        description: '使用时报错',
        status: 'pending',
      });
    });

    it('Skill 作者可以提交反馈', async () => {
      const skill = await publishedSkill();
      await createFeedback(owner, skill.id, '自测问题', '描述').expect(201);
    });

    it('不可见的 Skill 返回 404', async () => {
      const skill: SkillDetail = (await create(admin, 'private-skill').expect(201)).body;
      await prisma.skill.update({
        where: { id: skill.id },
        data: { visibility: 'private' },
      });
      await createFeedback(employee, skill.id, '问题', '描述').expect(404);
    });

    it('缺少标题返回 400', async () => {
      const skill = await publishedSkill();
      await createFeedback(employee, skill.id, '', '描述').expect(400);
    });

    it('缺少描述返回 400', async () => {
      const skill = await publishedSkill();
      await createFeedback(employee, skill.id, '标题', '').expect(400);
    });

    it('可选的 contextVersionId 校验属于该 Skill 的 published 版本', async () => {
      const skill = await publishedSkill();
      const version = await prisma.skillVersion.findFirstOrThrow({ where: { skillId: skill.id, status: 'published' } });
      await createFeedback(employee, skill.id, '问题', '描述', version.id).expect(201);

      const skill2: SkillDetail = (await create(admin, 'other-tool').expect(201)).body;
      const otherVersion = await prisma.skillVersion.findFirstOrThrow({ where: { skillId: skill2.id, status: 'published' } });
      await createFeedback(employee, skill.id, '问题', '描述', otherVersion.id).expect(400);
    });

    it('同一个 Skill 可以提交多条反馈', async () => {
      const skill = await publishedSkill();
      await createFeedback(employee, skill.id, '问题1', '描述1').expect(201);
      await createFeedback(employee, skill.id, '问题2', '描述2').expect(201);
      const list = await feedbacks(employee, skill.id);
      expect(list.body).toHaveLength(2);
    });
  });

  describe('查看反馈列表', () => {
    it('能访问 Skill 的人可以看到列表', async () => {
      const skill = await publishedSkill();
      await createFeedback(employee, skill.id, '问题', '描述');
      const res = await feedbacks(employee, skill.id).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('问题');
    });

    it('列表按 createdAt 倒序', async () => {
      const skill = await publishedSkill();
      await createFeedback(employee, skill.id, '问题1', '描述1');
      await createFeedback(employee, skill.id, '问题2', '描述2');
      const res = await feedbacks(employee, skill.id);
      expect(res.body[0].title).toBe('问题2');
      expect(res.body[1].title).toBe('问题1');
    });

    it('按 status 筛选', async () => {
      const skill = await publishedSkill();
      const f1 = await createFeedback(employee, skill.id, '问题1', '描述1');
      await createFeedback(employee, skill.id, '问题2', '描述2');
      await updateFeedback(admin, skill.id, f1.body.id, 'resolved', '已修复');

      const all = await feedbacks(employee, skill.id);
      expect(all.body).toHaveLength(2);

      const pending = await feedbacks(employee, skill.id, 'pending');
      expect(pending.body).toHaveLength(1);
      expect(pending.body[0].title).toBe('问题2');

      const resolved = await feedbacks(employee, skill.id, 'resolved');
      expect(resolved.body).toHaveLength(1);
      expect(resolved.body[0].title).toBe('问题1');
    });

    it('不可见的 Skill 返回 404', async () => {
      const skill: SkillDetail = (await create(admin, 'private-skill').expect(201)).body;
      await prisma.skill.update({
        where: { id: skill.id },
        data: { visibility: 'private' },
      });
      await feedbacks(employee, skill.id).expect(404);
    });
  });

  describe('管理反馈状态', () => {
    it('Skill 作者可以改状态', async () => {
      const skill = await publishedSkill();
      const f = await createFeedback(employee, skill.id, '问题', '描述');
      await updateFeedback(owner, skill.id, f.body.id, 'in_progress').expect(200);

      const list = await feedbacks(employee, skill.id);
      expect(list.body[0].status).toBe('in_progress');
    });

    it('租户管理员可以改状态', async () => {
      const skill = await publishedSkill();
      const f = await createFeedback(employee, skill.id, '问题', '描述');
      await updateFeedback(admin, skill.id, f.body.id, 'in_progress').expect(200);
    });

    it('非作者非管理员返回 403', async () => {
      const skill = await publishedSkill();
      const f = await createFeedback(employee, skill.id, '问题', '描述');
      const otherEmployee = await employeeAgent(app, prisma, tenantId, (await prisma.department.findFirstOrThrow()).id, '13800000003', '其他人');
      await updateFeedback(otherEmployee.agent, skill.id, f.body.id, 'in_progress').expect(403);
    });

    it('pending 可以直接到 resolved', async () => {
      const skill = await publishedSkill();
      const f = await createFeedback(employee, skill.id, '问题', '描述');
      await updateFeedback(admin, skill.id, f.body.id, 'resolved', '已修复').expect(200);

      const list = await feedbacks(employee, skill.id);
      expect(list.body[0].status).toBe('resolved');
      expect(list.body[0].resolution).toBe('已修复');
      expect(list.body[0].resolvedAt).not.toBeNull();
    });

    it('resolved 必须提供 resolution', async () => {
      const skill = await publishedSkill();
      const f = await createFeedback(employee, skill.id, '问题', '描述');
      await updateFeedback(admin, skill.id, f.body.id, 'resolved').expect(400);
    });

    it('不允许回退状态', async () => {
      const skill = await publishedSkill();
      const f = await createFeedback(employee, skill.id, '问题', '描述');
      await updateFeedback(admin, skill.id, f.body.id, 'resolved', '已修复');
      await updateFeedback(admin, skill.id, f.body.id, 'pending').expect(409);
    });

    it('不允许无效转换', async () => {
      const skill = await publishedSkill();
      const f = await createFeedback(employee, skill.id, '问题', '描述');
      await updateFeedback(admin, skill.id, f.body.id, 'resolved', '已修复');
      await updateFeedback(admin, skill.id, f.body.id, 'in_progress').expect(409);
    });

    it('并发状态更新不产生不一致', async () => {
      const skill = await publishedSkill();
      const f = await createFeedback(employee, skill.id, '问题', '描述');
      const results = await Promise.all([
        updateFeedback(admin, skill.id, f.body.id, 'resolved', '修复1'),
        updateFeedback(admin, skill.id, f.body.id, 'resolved', '修复2'),
      ]);
      const success = results.filter((r) => r.status === 200);
      const conflict = results.filter((r) => r.status === 409);
      expect(success).toHaveLength(1);
      expect(conflict).toHaveLength(1);
    });
  });

  describe('待处理数量', () => {
    it('作者可以获取', async () => {
      const skill = await publishedSkill();
      await createFeedback(employee, skill.id, '问题1', '描述1');
      await createFeedback(employee, skill.id, '问题2', '描述2');
      const res = await pendingCount(owner, skill.id).expect(200);
      expect(res.body.count).toBe(2);
    });

    it('管理员可以获取', async () => {
      const skill = await publishedSkill();
      await createFeedback(employee, skill.id, '问题', '描述');
      const res = await pendingCount(admin, skill.id).expect(200);
      expect(res.body.count).toBe(1);
    });

    it('普通用户不可获取', async () => {
      const skill = await publishedSkill();
      await pendingCount(employee, skill.id).expect(403);
    });

    it('只计算 pending 状态', async () => {
      const skill = await publishedSkill();
      const f1 = await createFeedback(employee, skill.id, '问题1', '描述1');
      await createFeedback(employee, skill.id, '问题2', '描述2');
      await updateFeedback(admin, skill.id, f1.body.id, 'resolved', '已修复');
      const res = await pendingCount(owner, skill.id);
      expect(res.body.count).toBe(1);
    });
  });

  describe('级联删除', () => {
    it('删除 Skill 后反馈一并删除', async () => {
      const skill = await publishedSkill();
      await createFeedback(employee, skill.id, '问题', '描述');
      const countBefore = await prisma.skillFeedback.count({ where: { skillId: skill.id } });
      expect(countBefore).toBe(1);

      await admin.delete(`/api/skills/${skill.id}`).expect(204);

      const countAfter = await prisma.skillFeedback.count({ where: { skillId: skill.id } });
      expect(countAfter).toBe(0);
    });
  });

  describe('超管隔离', () => {
    it('超管无法访问反馈接口（无租户上下文返回 403）', async () => {
      const skill = await publishedSkill();
      await feedbacks(superAdmin, skill.id).expect(403);
      await createFeedback(superAdmin, skill.id, '问题', '描述').expect(403);
      await pendingCount(superAdmin, skill.id).expect(403);
    });
  });
});
