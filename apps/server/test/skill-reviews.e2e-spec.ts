import type { NestExpressApplication } from '@nestjs/platform-express';
import type { MySkill, PendingSkillReview, SkillBadges, SkillDetail, SkillReviewRecordPage, SkillSummary, SkillVersionDetail } from '@skill-hub/shared';
import { strFromU8, unzipSync } from 'fflate';
import { existsSync, readdirSync } from 'node:fs';
import TestAgent from 'supertest/lib/agent';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedSuperAdmin } from './users';
import { createTestApp } from './app';
import { resetDatabase } from './reset-database';
import { binary, skillMd, versionZip, zipOf } from './skill-zips';
import { employeeAgent, superAdminAgent, tenantAdminAgent } from './users';

const PRIVATE_DIR = process.env.PRIVATE_UPLOAD_DIR!;
const CHANGED = (status: string) => `该版本状态已变化（当前：${status}），可能已被他人处理，请刷新后查看`;

describe('Skill 员工上传与审核流程', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;
  let admin2: TestAgent;
  let owner: TestAgent;
  let other: TestAgent;
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
    ({ agent: other } = await employeeAgent(app, prisma, tenantId, rootId, '13800000002', '韩梅梅'));
    const second = await employeeAgent(app, prisma, tenantId, rootId, '13900000002', '第二管理员');
    await prisma.employee.update({ where: { id: second.employeeId }, data: { isTenantAdmin: true } });
    admin2 = second.agent;
  });

  afterAll(async () => {
    await app.close();
  });

  /** 新建 Skill；mode 不传时按身份默认（管理员直接发布、员工提交审核） */
  function create(as: TestAgent, name: string, mode?: string, version = '1.0.0', marker = `v${version}`) {
    const req = as.post('/api/skills').attach('file', versionZip(name, marker), 'skill.zip').field('version', version);
    return mode ? req.field('mode', mode) : req;
  }
  function newVersion(as: TestAgent, skillId: string, version: string, mode?: string, name = 'pdf-tools') {
    const req = as.post(`/api/skills/${skillId}/versions`).attach('file', versionZip(name, `v${version}`), 'skill.zip').field('version', version);
    return mode ? req.field('mode', mode) : req;
  }
  const act = (as: TestAgent, skillId: string, versionId: string, action: string, body?: object) =>
    as.post(`/api/skills/${skillId}/versions/${versionId}/${action}`).send(body ?? {});
  const detail = async (as: TestAgent, id: string): Promise<SkillDetail> => (await as.get(`/api/skills/${id}`).expect(200)).body;
  const badges = async (as: TestAgent): Promise<SkillBadges> => (await as.get('/api/skills/badges').expect(200)).body;
  const download = (as: TestAgent, skillId: string, versionId: string) => as.get(`/api/skills/${skillId}/versions/${versionId}/download`).buffer(true).parse(binary);
  const versionMarker = async (as: TestAgent, skillId: string, versionId: string, name = 'pdf-tools') =>
    strFromU8(unzipSync((await download(as, skillId, versionId).expect(200)).body)[`${name}/VERSION.txt`]);
  const privateFiles = () => (existsSync(PRIVATE_DIR) ? readdirSync(PRIVATE_DIR) : []);

  /** 员工新建 pdf-tools 并提交审核，返回 Skill 与审核中版本的 id */
  async function pendingSkill(): Promise<{ skillId: string; versionId: string }> {
    const skill: SkillDetail = (await create(owner, 'pdf-tools').expect(201)).body;
    return { skillId: skill.id, versionId: skill.workingVersion!.id };
  }

  /** 管理员发布 pdf-tools 1.0.0，所有者转给员工李雷（模拟员工自己的 Skill 已有正式版本） */
  async function publishedSkillOwnedByStaff(): Promise<SkillDetail> {
    const skill: SkillDetail = (await create(admin, 'pdf-tools').expect(201)).body;
    const staff = await prisma.employee.findFirstOrThrow({ where: { tenantId, user: { phone: '13800000001' } } });
    await prisma.skill.update({ where: { id: skill.id }, data: { ownerEmployeeId: staff.id } });
    return skill;
  }

  describe('上传时的去向', () => {
    it('员工新建 Skill 默认提交审核：只有所有者与管理员能看到，其他员工完全看不到', async () => {
      const skill: SkillDetail = (await create(owner, 'pdf-tools').expect(201)).body;

      expect(skill).toMatchObject({ isOwner: true, currentVersion: null, versions: [], workingVersion: { version: '1.0.0', status: 'pending', rejectComment: null } });
      expect(skill.reviewRecords.map((r) => r.action)).toEqual(['submit']);
      const versionId = skill.workingVersion!.id;

      // 其他员工：列表、详情、下载、版本详情都看不到
      expect((await other.get('/api/skills').expect(200)).body).toEqual([]);
      await other.get(`/api/skills/${skill.id}`).expect(404);
      await download(other, skill.id, versionId).expect(404);
      await other.get(`/api/skills/review-links/${versionId}`).expect(403);
      // 管理员能看到详情并下载审核中的版本审阅；目录列表只列有正式版本的 Skill
      expect(await detail(admin, skill.id)).toMatchObject({ isOwner: false, workingVersion: { status: 'pending' } });
      expect(await versionMarker(admin, skill.id, versionId)).toBe('v1.0.0');
      expect((await admin.get('/api/skills').expect(200)).body).toEqual([]);
    });

    it('员工可以先存草稿：不产生审核记录，不进入待审核列表', async () => {
      const skill: SkillDetail = (await create(owner, 'pdf-tools', 'draft').expect(201)).body;
      expect(skill.workingVersion).toMatchObject({ status: 'draft' });
      expect(skill.reviewRecords).toEqual([]);
      expect((await admin.get('/api/skills/reviews').expect(200)).body).toEqual([]);
    });

    it('员工不能直接发布', async () => {
      const res = await create(owner, 'pdf-tools', 'publish').expect(403);
      expect(res.body.message).toBe('只有租户管理员可以直接发布，其他人上传须提交审核');
    });

    it('租户管理员可选直接发布或存草稿，不需要提交审核', async () => {
      expect((await create(admin, 'published-skill', 'publish').expect(201)).body.currentVersion).toMatchObject({ version: '1.0.0' });
      expect((await create(admin, 'draft-skill', 'draft').expect(201)).body.workingVersion).toMatchObject({ status: 'draft' });
      const res = await create(admin, 'submit-skill', 'submit').expect(400);
      expect(res.body.message).toBe('租户管理员上传可选直接发布或存草稿');
    });

    it('去向取值不正确被拒绝', async () => {
      const res = await create(owner, 'pdf-tools', 'later').expect(400);
      expect(res.body.message).toBe('上传去向不正确');
    });

    it('员工为自己的 Skill 上传新版本：进入审核，审核期间旧的正式版本照常可用，其他人看不到新版本', async () => {
      const skill = await publishedSkillOwnedByStaff();

      const updated: SkillDetail = (await newVersion(owner, skill.id, '1.1.0').expect(201)).body;

      expect(updated).toMatchObject({ currentVersion: { version: '1.0.0' }, workingVersion: { version: '1.1.0', status: 'pending' } });
      const seen = await detail(other, skill.id);
      expect(seen).toMatchObject({ currentVersion: { version: '1.0.0' }, workingVersion: null, reviewRecords: [] });
      expect(seen.versions.map((v) => v.version)).toEqual(['1.0.0']);
      expect(await versionMarker(other, skill.id, skill.currentVersion!.id)).toBe('v1.0.0');
      await download(other, skill.id, updated.workingVersion!.id).expect(404);
      expect(((await other.get('/api/skills').expect(200)).body as SkillSummary[])[0].currentVersion.version).toBe('1.0.0');
    });

    it('已有非正式版本时，再上传新版本被拒绝（所有者与管理员都一样）', async () => {
      const skill = await publishedSkillOwnedByStaff();
      await newVersion(owner, skill.id, '1.1.0', 'draft').expect(201);

      const message = '该 Skill 已有未成为正式的版本 1.1.0（草稿），请先处理后再上传新版本';
      expect((await newVersion(owner, skill.id, '1.2.0').expect(409)).body.message).toBe(message);
      expect((await newVersion(admin, skill.id, '1.2.0').expect(409)).body.message).toBe(message);
    });
  });

  describe('状态流转', () => {
    it('提交：草稿 → 审核中，记一条提交记录；重复提交返回「已被处理」', async () => {
      const skill: SkillDetail = (await create(owner, 'pdf-tools', 'draft').expect(201)).body;
      const versionId = skill.workingVersion!.id;

      await act(owner, skill.id, versionId, 'submit').expect(204);

      const after = await detail(owner, skill.id);
      expect(after.workingVersion).toMatchObject({ status: 'pending' });
      expect(after.reviewRecords).toEqual([expect.objectContaining({ action: 'submit', actorName: '李雷', version: '1.0.0' })]);
      expect((await act(owner, skill.id, versionId, 'submit').expect(409)).body.message).toBe(CHANGED('审核中'));
    });

    it('撤回：审核中 → 草稿；只有所有者可以撤回', async () => {
      const { skillId, versionId } = await pendingSkill();

      expect((await act(admin, skillId, versionId, 'withdraw').expect(403)).body.message).toBe('只有该 Skill 的所有者可以提交或撤回审核');
      expect((await act(other, skillId, versionId, 'withdraw').expect(404)).body.message).toBe('Skill 不存在');
      await act(owner, skillId, versionId, 'withdraw').expect(204);

      const after = await detail(owner, skillId);
      expect(after.workingVersion).toMatchObject({ status: 'draft', rejectComment: null });
      expect(after.reviewRecords.map((r) => r.action)).toEqual(['withdraw', 'submit']);
    });

    it('通过：审核中 → 正式，成为当前版本，其他员工随即可见', async () => {
      const { skillId, versionId } = await pendingSkill();

      await act(admin, skillId, versionId, 'approve').expect(204);

      const seen = await detail(other, skillId);
      expect(seen).toMatchObject({ currentVersion: { id: versionId, version: '1.0.0' }, workingVersion: null });
      expect((await detail(owner, skillId)).reviewRecords).toEqual([
        expect.objectContaining({ action: 'approve', actorName: '甲公司管理员' }),
        expect.objectContaining({ action: 'submit', actorName: '李雷' }),
      ]);
    });

    it('驳回：必须填写意见；审核中 → 草稿，意见展示给所有者', async () => {
      const { skillId, versionId } = await pendingSkill();

      expect((await act(admin, skillId, versionId, 'reject').expect(400)).body.message).toBe('请填写驳回意见');
      expect((await act(admin, skillId, versionId, 'reject', { comment: '   ' }).expect(400)).body.message).toBe('请填写驳回意见');
      expect((await act(admin, skillId, versionId, 'reject', { comment: '长'.repeat(501) }).expect(400)).body.message).toBe('驳回意见不能超过 500 字');
      await act(admin, skillId, versionId, 'reject', { comment: '缺少使用示例，请补充' }).expect(204);

      const after = await detail(owner, skillId);
      expect(after.workingVersion).toMatchObject({ status: 'draft', rejectComment: '缺少使用示例，请补充' });
      expect(after.reviewRecords[0]).toMatchObject({ action: 'reject', comment: '缺少使用示例，请补充', actorName: '甲公司管理员' });
    });

    it('普通员工不能通过或驳回', async () => {
      const { skillId, versionId } = await pendingSkill();
      expect((await act(owner, skillId, versionId, 'approve').expect(403)).body.message).toBe('仅租户管理员可访问');
      await act(owner, skillId, versionId, 'reject', { comment: 'x' }).expect(403);
    });

    it('两名管理员同时处理同一个版本：只有一个成功，后到者得到「已被他人处理」', async () => {
      const { skillId, versionId } = await pendingSkill();

      const results = await Promise.all([
        act(admin, skillId, versionId, 'approve'),
        act(admin2, skillId, versionId, 'reject', { comment: '不通过' }),
        act(admin, skillId, versionId, 'approve'),
      ]);

      expect(results.filter((r) => r.status === 204)).toHaveLength(1);
      for (const r of results.filter((r) => r.status !== 204)) {
        expect(r.status).toBe(409);
        expect(r.body.message).toMatch(/^该版本状态已变化（当前：(正式|草稿)），可能已被他人处理，请刷新后查看$/);
      }
      const records = await prisma.skillReviewRecord.findMany({ where: { versionId, action: { in: ['approve', 'reject'] } } });
      expect(records).toHaveLength(1);
    });

    it('管理员发布自己存的草稿（直接发布）；不能直接发布员工的草稿，员工也不能直接发布', async () => {
      const mine: SkillDetail = (await create(admin, 'admin-draft', 'draft').expect(201)).body;
      await act(admin, mine.id, mine.workingVersion!.id, 'publish').expect(204);
      expect(await detail(other, mine.id)).toMatchObject({ currentVersion: { version: '1.0.0' } });
      expect((await detail(admin, mine.id)).reviewRecords.map((r) => r.action)).toEqual(['publish_direct']);

      const staffDraft: SkillDetail = (await create(owner, 'staff-draft', 'draft').expect(201)).body;
      expect((await act(admin, staffDraft.id, staffDraft.workingVersion!.id, 'publish').expect(403)).body.message).toBe(
        '只有上传该草稿的租户管理员可以直接发布，员工的草稿须提交审核',
      );
      await act(owner, staffDraft.id, staffDraft.workingVersion!.id, 'publish').expect(403);
    });
  });

  describe('修改草稿与删除草稿', () => {
    it('完整流程：提交 → 驳回 → 重新上传修改后的包 → 再次提交 → 通过，当前版本是修改后的内容', async () => {
      const { skillId, versionId } = await pendingSkill();
      await act(admin, skillId, versionId, 'reject', { comment: '请补充示例' }).expect(204);

      const fixed = zipOf({ 'pdf-tools/SKILL.md': skillMd('pdf-tools', 'pdf-tools 已补充示例'), 'pdf-tools/VERSION.txt': 'fixed' });
      const replaced: SkillDetail = (await owner.put(`/api/skills/${skillId}/versions/${versionId}/package`).attach('file', fixed, 'skill.zip').expect(200)).body;
      // 重新上传后仍显示驳回意见，直到再次提交
      expect(replaced.workingVersion).toMatchObject({ id: versionId, version: '1.0.0', status: 'draft', description: 'pdf-tools 已补充示例', rejectComment: '请补充示例' });

      await act(owner, skillId, versionId, 'submit').expect(204);
      await act(admin, skillId, versionId, 'approve').expect(204);

      expect(await versionMarker(other, skillId, versionId)).toBe('fixed');
      expect((await detail(owner, skillId)).reviewRecords.map((r) => r.action)).toEqual(['approve', 'submit', 'reupload', 'reject', 'submit']);
    });

    it('重新上传：只能用于草稿；name 须一致；只有所有者能操作；旧包文件被替换删除', async () => {
      const { skillId, versionId } = await pendingSkill();
      const put = (as: TestAgent, zip: Buffer) => as.put(`/api/skills/${skillId}/versions/${versionId}/package`).attach('file', zip, 'skill.zip');

      expect((await put(owner, versionZip('pdf-tools', 'x')).expect(409)).body.message).toBe('只有草稿可以重新上传，审核中的版本请先撤回');
      await act(owner, skillId, versionId, 'withdraw').expect(204);
      expect((await put(owner, versionZip('pdf-toolkit', 'x')).expect(400)).body.message).toBe(
        '新版本 SKILL.md 的 name「pdf-toolkit」与 Skill 名称「pdf-tools」不一致',
      );
      expect((await put(admin, versionZip('pdf-tools', 'x')).expect(403)).body.message).toBe('只有该 Skill 的所有者或这个草稿的上传人可以修改或删除它');

      const before = await prisma.skillVersion.findUniqueOrThrow({ where: { id: versionId } });
      await put(owner, versionZip('pdf-tools', 'v2')).expect(200);
      expect(privateFiles()).not.toContain(before.storageKey);
    });

    it('所有者删除自己的草稿：文件一并删除；只剩这一个版本时 Skill 也一并删除', async () => {
      const skill = await publishedSkillOwnedByStaff();
      const draft: SkillDetail = (await newVersion(owner, skill.id, '1.1.0', 'draft').expect(201)).body;
      const { storageKey } = await prisma.skillVersion.findUniqueOrThrow({ where: { id: draft.workingVersion!.id } });

      await owner.delete(`/api/skills/${skill.id}/versions/${draft.workingVersion!.id}`).expect(204);
      expect(await detail(owner, skill.id)).toMatchObject({ workingVersion: null, currentVersion: { version: '1.0.0' } });
      expect(privateFiles()).not.toContain(storageKey);

      const only: SkillDetail = (await create(owner, 'only-draft', 'draft').expect(201)).body;
      await owner.delete(`/api/skills/${only.id}/versions/${only.workingVersion!.id}`).expect(204);
      expect(await prisma.skill.count({ where: { id: only.id } })).toBe(0);
    });

    it('员工删除版本的限制：审核中须先撤回、正式版本只有租户管理员能删、非所有者不能删（租户管理员的删除权限见治理用例）', async () => {
      const skill = await publishedSkillOwnedByStaff();
      const pending: SkillDetail = (await newVersion(owner, skill.id, '1.1.0').expect(201)).body;
      const del = (as: TestAgent, versionId: string) => as.delete(`/api/skills/${skill.id}/versions/${versionId}`);

      expect((await del(owner, pending.workingVersion!.id).expect(409)).body.message).toBe('审核中的版本请先撤回再删除');
      expect((await del(owner, skill.currentVersion!.id).expect(403)).body.message).toBe('正式版本只有租户管理员可以删除');
      await act(owner, skill.id, pending.workingVersion!.id, 'withdraw').expect(204);
      await del(other, pending.workingVersion!.id).expect(404);
    });
  });

  describe('我的 Skill、审核列表、审核记录与红点', () => {
    it('「我的 Skill」列出我是所有者的 Skill 与各版本状态，被驳回的草稿带上意见', async () => {
      await publishedSkillOwnedByStaff();
      const { skillId, versionId } = await (async () => {
        const s: SkillDetail = (await create(owner, 'meeting-notes').expect(201)).body;
        return { skillId: s.id, versionId: s.workingVersion!.id };
      })();
      await act(admin, skillId, versionId, 'reject', { comment: '描述太简单' }).expect(204);
      await create(admin, 'admin-only').expect(201);

      const mine: MySkill[] = (await owner.get('/api/skills/mine').expect(200)).body;

      expect(mine.map((s) => s.name)).toEqual(['meeting-notes', 'pdf-tools']);
      expect(mine[0]).toMatchObject({ currentVersion: null, workingVersion: { status: 'draft', rejectComment: '描述太简单' } });
      expect(mine[1]).toMatchObject({ currentVersion: { version: '1.0.0' }, workingVersion: null });
    });

    it('待审核列表：按提交时间从早到晚，标出首次提交的 Skill；只有租户管理员可以访问', async () => {
      const skill = await publishedSkillOwnedByStaff();
      await newVersion(owner, skill.id, '1.1.0').expect(201);
      await create(owner, 'meeting-notes', undefined, '0.1.0').expect(201);

      const list: PendingSkillReview[] = (await admin.get('/api/skills/reviews').expect(200)).body;

      expect(list.map((r) => [r.skillName, r.version.version, r.isNewSkill])).toEqual([
        ['pdf-tools', '1.1.0', false],
        ['meeting-notes', '0.1.0', true],
      ]);
      expect(list[0].version.uploaderName).toBe('李雷');
      await owner.get('/api/skills/reviews').expect(403);
    });

    it('全租户审核记录：从新到旧、分页，不含其他租户', async () => {
      const { skillId, versionId } = await pendingSkill();
      await act(admin, skillId, versionId, 'reject', { comment: '再改改' }).expect(204);
      await act(owner, skillId, versionId, 'submit').expect(204);
      const { agent: otherAdmin } = await tenantAdminAgent(app, prisma, '乙公司', '13900000009');
      await create(otherAdmin, 'other-tenant').expect(201);

      const page1: SkillReviewRecordPage = (await admin.get('/api/skills/reviews/records?page=1&pageSize=2').expect(200)).body;
      const page2: SkillReviewRecordPage = (await admin.get('/api/skills/reviews/records?page=2&pageSize=2').expect(200)).body;

      expect(page1).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect([...page1.items, ...page2.items].map((r) => [r.action, r.actorName, r.skillName, r.comment])).toEqual([
        ['submit', '李雷', 'pdf-tools', ''],
        ['reject', '甲公司管理员', 'pdf-tools', '再改改'],
        ['submit', '李雷', 'pdf-tools', ''],
      ]);
      await owner.get('/api/skills/reviews/records').expect(403);
    });

    it('审核页内容（审核链接接口）：返回 SKILL.md 原文与该版本的审核记录；审核中的版本只有所有者和管理员能看', async () => {
      const md = '---\nname: xss-skill\ndescription: 测试\n---\n\n# 标题\n\n<script>alert(1)</script>\n';
      const skill: SkillDetail = (await owner.post('/api/skills').attach('file', zipOf({ 'xss-skill/SKILL.md': md }), 'skill.zip').field('version', '1.0.0').expect(201)).body;
      const versionId = skill.workingVersion!.id;

      const version: SkillVersionDetail = (await admin.get(`/api/skills/review-links/${versionId}`).expect(200)).body;

      expect(version).toMatchObject({ skillName: 'xss-skill', version: '1.0.0', status: 'pending', uploaderName: '李雷', skillMd: md });
      expect(version.records.map((r) => r.action)).toEqual(['submit']);
      await owner.get(`/api/skills/review-links/${versionId}`).expect(200);
      await other.get(`/api/skills/review-links/${versionId}`).expect(403);
    });

    it('红点：管理员的待审核数、员工被驳回且仍是草稿的数量，处理后随之消失', async () => {
      const { skillId, versionId } = await pendingSkill();
      expect(await badges(admin)).toEqual({ pendingReviews: 1, rejectedDrafts: 0 });
      expect(await badges(owner)).toEqual({ pendingReviews: 0, rejectedDrafts: 0 });

      await act(admin, skillId, versionId, 'reject', { comment: '再改改' }).expect(204);
      expect(await badges(admin)).toEqual({ pendingReviews: 0, rejectedDrafts: 0 });
      expect(await badges(owner)).toEqual({ pendingReviews: 0, rejectedDrafts: 1 });

      await act(owner, skillId, versionId, 'submit').expect(204);
      expect(await badges(owner)).toEqual({ pendingReviews: 0, rejectedDrafts: 0 });
      expect(await badges(admin)).toEqual({ pendingReviews: 1, rejectedDrafts: 0 });

      await act(admin, skillId, versionId, 'approve').expect(204);
      expect(await badges(admin)).toEqual({ pendingReviews: 0, rejectedDrafts: 0 });
    });

    it('超管不能访问审核接口', async () => {
      const superAdmin = await superAdminAgent(app, prisma);
      await superAdmin.get('/api/skills/reviews').expect(403);
      await superAdmin.get('/api/skills/badges').expect(403);
    });
  });
});
