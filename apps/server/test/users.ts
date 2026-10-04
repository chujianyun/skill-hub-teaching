import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { SESSION_COOKIE } from '@skill-hub/shared';
import { PrismaService } from '../src/prisma/prisma.service';

// Test fixtures create real sessions directly; no alternate login route exists in the app.
export async function sessionAgent(app: INestApplication, prisma: PrismaService, userId: string, tenantId: string | null = null) {
  const token = randomBytes(32).toString('base64url');
  await prisma.session.create({ data: { id: createHash('sha256').update(token).digest('hex'), userId, currentTenantId: tenantId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  return request.agent(app.getHttpServer()).set('Cookie', `${SESSION_COOKIE}=${token}`);
}
export async function seedSuperAdmin(prisma: PrismaService) {
  const user = await prisma.user.upsert({ where: { phone: 'root' }, update: {}, create: { phone: 'root', name: '超级管理员', nickname: '超管' } });
  await prisma.superAdmin.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
}
export async function superAdminAgent(app: INestApplication, prisma: PrismaService) {
  const user = await prisma.user.findUniqueOrThrow({ where: { phone: 'root' } });
  return sessionAgent(app, prisma, user.id);
}
export async function regularUserAgent(app: INestApplication, prisma: PrismaService, phone = '13800000002') {
  const user = await prisma.user.create({ data: { phone, name: '普通用户', nickname: '普通' } });
  return sessionAgent(app, prisma, user.id);
}
export async function tenantAdminAgent(app: INestApplication, prisma: PrismaService, tenantName: string, phone: string) {
  const tenant = await prisma.tenant.create({ data: { name: tenantName, departments: { create: { name: tenantName } } }, include: { departments: true } });
  const root = tenant.departments[0];
  const user = await prisma.user.create({ data: { phone, name: `${tenantName}管理员`, nickname: '管理员' } });
  await prisma.employee.create({ data: { userId: user.id, tenantId: tenant.id, departmentId: root.id, isTenantAdmin: true } });
  return { agent: await sessionAgent(app, prisma, user.id, tenant.id), tenantId: tenant.id, rootId: root.id };
}
export async function employeeAgent(app: INestApplication, prisma: PrismaService, tenantId: string, departmentId: string, phone: string, name = '普通员工') {
  const user = await prisma.user.create({ data: { phone, name, nickname: name } });
  const employee = await prisma.employee.create({ data: { userId: user.id, tenantId, departmentId } });
  return { agent: await sessionAgent(app, prisma, user.id, tenantId), employeeId: employee.id };
}
