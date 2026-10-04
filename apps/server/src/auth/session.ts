import type { User } from '../generated/prisma/client';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 守卫校验通过后挂到 request 上的登录上下文。 */
export interface AuthContext {
  user: User;
  /** user 在 SuperAdmin 表中有记录 */
  isSuperAdmin: boolean;
  sessionId: string;
  /** 会话当前租户（未必有权限，租户接口由 @TenantAdminOnly 校验） */
  currentTenantId: string | null;
  /** 通过 @TenantAdminOnly 校验后填充：当前租户及管理员档案 */
  tenantAdmin?: { tenantId: string; employeeId: string };
  /** 通过 @TenantMember 校验后填充：当前租户及员工档案 */
  employee?: CurrentEmployeeContext;
}

export interface CurrentEmployeeContext {
  tenantId: string;
  employeeId: string;
  isTenantAdmin: boolean;
}

declare module 'express' {
  interface Request {
    auth?: AuthContext;
  }
}
