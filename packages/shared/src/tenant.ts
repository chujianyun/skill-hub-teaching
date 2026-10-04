export type TenantStatus = 'active' | 'disabled';
export interface Tenant { id: string; name: string; avatarUrl: string | null; status: TenantStatus; remark: string; createdAt: string; updatedAt: string; }
