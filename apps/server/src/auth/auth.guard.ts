import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SESSION_COOKIE } from '@skill-hub/shared';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC, SUPER_ADMIN_ONLY, TENANT_ADMIN_ONLY, TENANT_MEMBER } from './decorators';

/**
 * 全局守卫：默认所有接口需登录；
 * @SuperAdminOnly 接口仅超管可访问；@TenantAdminOnly 接口仅当前租户的租户管理员可访问；
 * @TenantMember 接口仅当前租户的启用中员工可访问。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const auth = typeof token === 'string' ? await this.auth.authenticate(token) : null;
    if (!auth) throw new UnauthorizedException('请先登录');

    if (this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY, targets) && !auth.isSuperAdmin) {
      throw new ForbiddenException('仅超管可访问');
    }
    if (this.reflector.getAllAndOverride<boolean>(TENANT_ADMIN_ONLY, targets)) {
      if (!auth.currentTenantId) {
        throw new ForbiddenException(auth.isSuperAdmin ? '仅租户管理员可访问' : '请先选择要进入的租户');
      }
      const employee = await this.auth.findActiveTenantAdmin(auth);
      if (!employee) throw new ForbiddenException('仅租户管理员可访问');
      auth.tenantAdmin = { tenantId: employee.tenantId, employeeId: employee.id };
    }
    if (this.reflector.getAllAndOverride<boolean>(TENANT_MEMBER, targets)) {
      const employee = await this.auth.findActiveEmployee(auth);
      if (!employee) throw new ForbiddenException(auth.currentTenantId ? '仅本租户员工可访问' : '请先选择要进入的租户');
      auth.employee = { tenantId: employee.tenantId, employeeId: employee.id, isTenantAdmin: employee.isTenantAdmin };
    }
    req.auth = auth;
    return true;
  }
}
