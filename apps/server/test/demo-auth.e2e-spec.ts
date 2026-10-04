import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { SESSION_COOKIE } from '@skill-hub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEMO_ACCOUNTS, seedDemo } from '../src/seed/demo';
import { createTestApp } from './app';
import { resetDatabase } from './reset-database';
import { skillFolderZip } from './skill-zips';

describe('Fixed demo identities and persistence', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  beforeAll(async () => { ({ app, prisma } = await createTestApp()); });
  beforeEach(async () => { await resetDatabase(prisma); await seedDemo(prisma); });
  afterAll(async () => { await app.close(); });

  it.each(DEMO_ACCOUNTS)('logs in $phone without password changes and keeps session on refresh', async ({ phone, password }) => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent.post('/api/auth/login').send({ phone, password }).expect(200);
    expect(login.body).toEqual({ ok: true });
    const cookie = login.headers['set-cookie'][0];
    expect(cookie).toContain(`${SESSION_COOKIE}=`); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
    const token = cookie.split(';')[0].split('=')[1];
    const session = await prisma.session.findFirstOrThrow();
    expect(session.id).toBe(createHash('sha256').update(token).digest('hex'));
    expect(session.id).not.toBe(token);
    for (let i = 0; i < 2; i++) {
      const me = (await agent.get('/api/auth/me').expect(200)).body;
      expect(me.user.phone).toBe(phone);
      expect(me.user.isSuperAdmin).toBe(phone === 'root');
      expect(me.currentTenantId).toBe(phone === 'root' ? null : 'demo-tenant');
    }
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie.split(';')[0]).expect(401);
  });

  it('rejects wrong credentials, old source credentials, and arbitrary database users', async () => {
    await prisma.user.create({ data: { phone: 'not-a-demo', name: '测试', nickname: '测试' } });
    for (const [phone, password] of [['root', 'wrong'], ['admin', 'root'], ['not-a-demo', 'test'], ['15168466666', 'admin']]) {
      await request(app.getHttpServer()).post('/api/auth/login').send({ phone, password }).expect(401);
    }
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', `${SESSION_COOKIE}=demo-root`).expect(401);
  });

  it('uses server role and fixed tenant rather than submitted role or tenant', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ phone: '15168488888', password: 'test', isSuperAdmin: true, tenantId: 'other' }).expect(200);
    expect((await agent.get('/api/auth/me')).body.user.isSuperAdmin).toBe(false);
    await agent.get('/api/admin/tenants').expect(403);
    await agent.get('/api/skills/reviews').expect(403);
    await agent.post('/api/skills/categories').send({ name: '非法新增' }).expect(403);
  });

  it('does not register user management, password or OAuth routes', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ phone: 'root', password: 'admin' }).expect(200);
    for (const path of ['/api/auth/change-password', '/api/auth/switch-tenant', '/api/admin/tenants', '/api/admin/oauth-clients', '/api/tenant/employees', '/api/tenant/departments', '/oauth/token']) {
      await agent.post(path).send({}).expect(404);
    }
    for (const path of ['/api/client/skills', '/oauth/authorize', '/api/tenant/employees', '/api/tenant/departments']) await agent.get(path).expect(404);
    expect((await agent.get('/api/admin/tenants').expect(200)).body).toHaveLength(1);
  });

  it('keeps skills, packages and sessions through repeated seed and a server restart', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent.post('/api/auth/login').send({ phone: '15168466666', password: 'test' }).expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const skill = (await agent.post('/api/skills').attach('file', skillFolderZip('persist-demo'), 'skill.zip').field('version', '1.0.0').expect(201)).body;
    await seedDemo(prisma); await seedDemo(prisma);
    expect(await prisma.user.count()).toBe(3);
    expect(await prisma.department.count()).toBe(3);
    await app.close();
    ({ app, prisma } = await createTestApp());
    await request(app.getHttpServer()).get(`/api/skills/${skill.id}`).set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).get(`/api/skills/${skill.id}/versions/${skill.currentVersion.id}/download`).set('Cookie', cookie).expect(200);
  });

  it('rejects expired sessions', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ phone: 'root', password: 'admin' }).expect(200);
    await prisma.session.updateMany({ data: { expiresAt: new Date(0) } });
    await agent.get('/api/auth/me').expect(401);
  });
});
