import type { PrismaService } from '../prisma/prisma.service';

export const DEMO_TENANT_ID = 'demo-tenant';
export const DEMO_ACCOUNTS = [
  { phone: 'root', password: 'admin', name: '演示超管', id: 'demo-root' },
  { phone: '15168466666', password: 'test', name: '演示管理员', id: 'demo-admin' },
  { phone: '15168488888', password: 'test', name: '演示用户', id: 'demo-user' },
] as const;

/** Only insert missing fixtures. Never reset skills, sessions or existing demo work. */
export async function seedDemo(prisma: PrismaService) {
  await prisma.$transaction(async (tx) => {
    await tx.tenant.upsert({ where: { id: DEMO_TENANT_ID }, update: {}, create: { id: DEMO_TENANT_ID, name: 'Skill Hub 演示团队' } });
    for (const [id, name, parentId] of [
      ['demo-dept-root', '演示团队', null],
      ['demo-dept-dev', '研发部', 'demo-dept-root'],
      ['demo-dept-ops', '运营部', 'demo-dept-root'],
    ] as const) {
      await tx.department.upsert({ where: { id }, update: {}, create: { id, name, parentId, tenantId: DEMO_TENANT_ID } });
    }
    for (const account of DEMO_ACCOUNTS) {
      const user = await tx.user.upsert({ where: { phone: account.phone }, update: {}, create: { id: account.id, phone: account.phone, name: account.name, nickname: account.name } });
      if (account.phone === 'root') {
        await tx.superAdmin.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
      } else {
        await tx.employee.upsert({ where: { userId_tenantId: { userId: user.id, tenantId: DEMO_TENANT_ID } }, update: {}, create: {
          id: `${account.id}-employee`, userId: user.id, tenantId: DEMO_TENANT_ID,
          departmentId: account.phone === '15168466666' ? 'demo-dept-root' : 'demo-dept-dev',
          isTenantAdmin: account.phone === '15168466666',
        } });
      }
    }
  });
}
