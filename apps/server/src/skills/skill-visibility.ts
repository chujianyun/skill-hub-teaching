import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { SkillVisibilityInfo, SkillVisibilityInput } from '@skill-hub/shared';
import type { Prisma, SkillVisibility } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { canManage, notFound, type SkillViewer } from './skill-views';

/**
 * Skill 的可见性（设在 Skill 上、对所有版本生效）。「谁能看到正式版本」的唯一规则：
 * 所有者、租户管理员（与超管）不受限制；其他员工要求未下架，且按可见性判断——租户可见、所选部门或其下级部门、名单中的员工；仅自己可见则只有所有者。
 * 部门按员工当前所在部门实时计算（换部门立即生效）。
 */

export const withVisibility = {
  visibleDepartments: { include: { department: true } },
  visibleEmployees: { include: { employee: { include: { user: true } } } },
} satisfies Prisma.SkillInclude;
type SkillWithVisibility = Prisma.SkillGetPayload<{ include: typeof withVisibility }>;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'zh-CN');

export function toVisibilityInfo(skill: SkillWithVisibility): SkillVisibilityInfo {
  return {
    visibility: skill.visibility,
    departments: skill.visibleDepartments.map((d) => ({ id: d.department.id, name: d.department.name })).sort(byName),
    employees: skill.visibleEmployees.map((e) => ({ id: e.employee.id, name: e.employee.user.name })).sort(byName),
  };
}

/** 部门及其所有上级部门的 id（选了其中任何一个部门的 Skill 对该部门的员工可见） */
async function departmentWithAncestors(prisma: PrismaService, tenantId: string, departmentId: string): Promise<string[]> {
  const departments = await prisma.department.findMany({ where: { tenantId }, select: { id: true, parentId: true } });
  const parentOf = new Map(departments.map((d) => [d.id, d.parentId]));
  const chain: string[] = [];
  for (let id: string | null | undefined = departmentId; id && !chain.includes(id); id = parentOf.get(id)) chain.push(id);
  return chain;
}

/** 当前员工能看到的 Skill 的查询条件（只管可见性；是否有正式版本由调用方另加条件）。租户管理员不受限制。 */
export async function visibleSkillWhere(prisma: PrismaService, viewer: SkillViewer): Promise<Prisma.SkillWhereInput> {
  if (viewer.isTenantAdmin) return {};
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: viewer.employeeId }, select: { departmentId: true } });
  const departmentIds = await departmentWithAncestors(prisma, viewer.tenantId, employee.departmentId);
  return {
    OR: [
      { ownerEmployeeId: viewer.employeeId },
      // 已下架的 Skill 除所有者与管理员外都看不到
      {
        unlisted: false,
        OR: [
          { visibility: 'tenant' },
          { visibility: 'departments', visibleDepartments: { some: { departmentId: { in: departmentIds } } } },
          { visibility: 'employees', visibleEmployees: { some: { employeeId: viewer.employeeId } } },
        ],
      },
    ],
  };
}

export async function canSeeSkill(prisma: PrismaService, viewer: SkillViewer, skillId: string): Promise<boolean> {
  return (await prisma.skill.count({ where: { id: skillId, tenantId: viewer.tenantId, AND: [await visibleSkillWhere(prisma, viewer)] } })) > 0;
}

/** 当前员工能否看到这个 Skill：所有者与租户管理员总能看到；其他人须有正式版本且可见性命中 */
export async function canViewSkill(prisma: PrismaService, viewer: SkillViewer, skill: { id: string; ownerEmployeeId: string }): Promise<boolean> {
  if (canManage(viewer, skill)) return true;
  return (await prisma.skillVersion.count({ where: { skillId: skill.id, status: 'published' } })) > 0 && canSeeSkill(prisma, viewer, skill.id);
}

/** 只有所有者与租户管理员可以做的操作：看不到这个 Skill 的人一律 404（不暴露存在），看得到的人 403 */
export async function assertCanManage(prisma: PrismaService, viewer: SkillViewer, skill: { id: string; ownerEmployeeId: string }, forbiddenMessage: string): Promise<void> {
  if (canManage(viewer, skill)) return;
  if (!(await canViewSkill(prisma, viewer, skill))) throw notFound();
  throw new ForbiddenException(forbiddenMessage);
}

export interface ResolvedVisibility {
  visibility: SkillVisibility;
  departmentIds: string[];
  employeeIds: string[];
}

/** 校验可见性设置：部门、员工须属于本租户；特定部门可见至少选一个部门；特定员工可见时所有者始终在名单中。 */
export async function resolveVisibility(prisma: PrismaService, tenantId: string, ownerEmployeeId: string, input: SkillVisibilityInput): Promise<ResolvedVisibility> {
  const visibility = input.visibility;
  if (visibility === 'departments') {
    const departmentIds = [...new Set(input.departmentIds ?? [])];
    if (departmentIds.length === 0) throw new BadRequestException('请选择可见的部门');
    if ((await prisma.department.count({ where: { tenantId, id: { in: departmentIds } } })) !== departmentIds.length) throw new BadRequestException('所选部门不存在');
    return { visibility, departmentIds, employeeIds: [] };
  }
  if (visibility === 'employees') {
    const employeeIds = [...new Set([...(input.employeeIds ?? []), ownerEmployeeId])];
    if ((await prisma.employee.count({ where: { tenantId, id: { in: employeeIds } } })) !== employeeIds.length) throw new BadRequestException('所选员工不存在');
    return { visibility, departmentIds: [], employeeIds };
  }
  return { visibility, departmentIds: [], employeeIds: [] };
}

/** 写入可见性（先清空原有的部门、员工名单） */
export async function writeVisibility(tx: Prisma.TransactionClient, skillId: string, v: ResolvedVisibility): Promise<void> {
  await tx.skill.update({ where: { id: skillId }, data: { visibility: v.visibility } });
  await tx.skillVisibleDepartment.deleteMany({ where: { skillId } });
  await tx.skillVisibleEmployee.deleteMany({ where: { skillId } });
  if (v.departmentIds.length) await tx.skillVisibleDepartment.createMany({ data: v.departmentIds.map((departmentId) => ({ skillId, departmentId })) });
  if (v.employeeIds.length) await tx.skillVisibleEmployee.createMany({ data: v.employeeIds.map((employeeId) => ({ skillId, employeeId })) });
}
