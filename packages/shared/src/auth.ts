import type { TenantStatus } from './tenant';
export const SESSION_COOKIE = 'skill_hub_demo_sid';
export interface LoginRequest { phone: string; password: string; }
export interface LoginResponse { ok: true; }
export interface CurrentUser {
  id: string;
  phone: string;
  name: string;
  nickname: string;
  email: string | null;
  isSuperAdmin: boolean;
}

export type EmployeeStatus = 'active' | 'disabled';

/** 当前用户在某个租户下的档案。 */
export interface EmployeeProfile {
  id: string;
  tenant: { id: string; name: string; avatarUrl: string | null; status: TenantStatus };
  status: EmployeeStatus;
  isTenantAdmin: boolean;
}

/** 档案与所在租户都启用时才能进入该租户。 */
export const canEnterTenant = (e: EmployeeProfile) => e.status === 'active' && e.tenant.status === 'active';

export interface MeResponse {
  user: CurrentUser;
  employees: EmployeeProfile[];
  /** 会话当前租户上下文；无可用档案时为 null */
  currentTenantId: string | null;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  code?: string;
}
