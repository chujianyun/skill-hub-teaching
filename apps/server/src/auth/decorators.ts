import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext, CurrentEmployeeContext } from './session';
export const IS_PUBLIC = 'auth:isPublic';
export const SUPER_ADMIN_ONLY = 'auth:superAdminOnly';
export const TENANT_ADMIN_ONLY = 'auth:tenantAdminOnly';
export const TENANT_MEMBER = 'auth:tenantMember';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);
export const TenantAdminOnly = () => SetMetadata(TENANT_ADMIN_ONLY, true);
export const TenantMember = () => SetMetadata(TENANT_MEMBER, true);
export const CurrentEmployee = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentEmployeeContext => ctx.switchToHttp().getRequest<Request>().auth!.employee!,
);
export const Auth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => ctx.switchToHttp().getRequest<Request>().auth!,
);
