import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { MeResponse } from '@skill-hub/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { Employee } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEMO_ACCOUNTS } from '../seed/demo';
import { AuthContext, SESSION_TTL_MS } from './session';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(phone: string, password: string): Promise<{ token: string }> {
    const account = DEMO_ACCOUNTS.find((a) => a.phone === phone && a.password === password);
    if (!account) throw new UnauthorizedException('账号或密码错误');
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new UnauthorizedException('演示账号尚未初始化，请运行 pnpm setup');
    const employee = await this.prisma.employee.findFirst({ where: { userId: user.id, status: 'active', tenant: { status: 'active' } } });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({ data: { id: hashToken(token), userId: user.id, currentTenantId: employee?.tenantId ?? null, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    return { token };
  }

  async logout(sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async authenticate(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({ where: { id: hashToken(token) }, include: { user: { include: { superAdmin: true } } } });
    if (!session || session.expiresAt <= new Date()) return null;
    const { superAdmin, ...user } = session.user;
    return { user, isSuperAdmin: superAdmin !== null, sessionId: session.id, currentTenantId: session.currentTenantId };
  }

  /** 会话当前租户（须启用）下的启用中档案（不论是否管理员）；没有则返回 null。 */
  findActiveEmployee({ user, currentTenantId }: AuthContext): Promise<Employee | null> {
    if (!currentTenantId) return Promise.resolve(null);
    return this.prisma.employee.findFirst({ where: { userId: user.id, tenantId: currentTenantId, status: 'active', tenant: { status: 'active' } } });
  }

  /** 会话当前租户（须启用）下的启用中管理员档案；没有则返回 null。 */
  findActiveTenantAdmin({ user, currentTenantId }: AuthContext): Promise<Employee | null> {
    if (!currentTenantId) return Promise.resolve(null);
    return this.prisma.employee.findFirst({
      where: { userId: user.id, tenantId: currentTenantId, status: 'active', isTenantAdmin: true, tenant: { status: 'active' } },
    });
  }

  async me({ user, isSuperAdmin, currentTenantId }: AuthContext): Promise<MeResponse> {
    const employees = await this.prisma.employee.findMany({
      where: { userId: user.id },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        nickname: user.nickname,
        email: user.email,
        isSuperAdmin,
      },
      employees: employees.map((e) => ({
        id: e.id,
        tenant: { id: e.tenant.id, name: e.tenant.name, avatarUrl: e.tenant.avatarUrl, status: e.tenant.status },
        status: e.status,
        isTenantAdmin: e.isTenantAdmin,
      })),
      currentTenantId,
    };
  }

}
