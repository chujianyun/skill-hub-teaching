import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SKILL_CATEGORIES_MAX, SKILL_CATEGORY_PRESETS, type SkillCategoryItem } from '@skill-hub/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const categoryNotFound = () => new NotFoundException('分类不存在');
const tooMany = () => new BadRequestException(`每个租户最多 ${SKILL_CATEGORIES_MAX} 个分类`);

/** 取本租户的分类；不属于本租户（含其他租户的分类）一律视为不存在。供上传、修改 Skill 分类时校验。 */
export async function findTenantCategory(prisma: Prisma.TransactionClient, tenantId: string, categoryId: string) {
  const category = await prisma.skillCategory.findFirst({ where: { id: categoryId, tenantId } });
  if (!category) throw new BadRequestException('所选分类不存在，请刷新后重试');
  return category;
}

/**
 * Skill 分类（#20）：按租户隔离，只有租户管理员能增删改；名称在租户内唯一；按创建时间排序。
 * 删除分类时，使用它的 Skill 变为未分类（外键 SET NULL）。
 */
@Injectable()
export class SkillCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 本租户的分类；withCounts（租户管理员）时带上每个分类的 Skill 数 */
  async list(tenantId: string, withCounts: boolean): Promise<SkillCategoryItem[]> {
    const categories = await this.prisma.skillCategory.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      include: withCounts ? { _count: { select: { skills: true } } } : undefined,
    });
    return categories.map((c) => ({ id: c.id, name: c.name, skillCount: '_count' in c ? (c._count as { skills: number }).skills : null }));
  }

  async create(tenantId: string, name: string): Promise<SkillCategoryItem[]> {
    await this.unique(name, async () => {
      // 锁租户行，串行化同一租户的并发新增，保证不超过上限
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
        if ((await tx.skillCategory.count({ where: { tenantId } })) >= SKILL_CATEGORIES_MAX) throw tooMany();
        await tx.skillCategory.create({ data: { tenantId, name } });
      });
    });
    return this.list(tenantId, true);
  }

  /** 一键添加常用分类：只补上本租户还没有的，重复调用无副作用 */
  async addPresets(tenantId: string): Promise<SkillCategoryItem[]> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
      const existing = new Set((await tx.skillCategory.findMany({ where: { tenantId }, select: { name: true } })).map((c) => c.name));
      const missing = SKILL_CATEGORY_PRESETS.filter((name) => !existing.has(name));
      if (existing.size + missing.length > SKILL_CATEGORIES_MAX) throw tooMany();
      // 创建时间逐个错开 1 毫秒，列表按预设顺序展示
      const now = Date.now();
      await tx.skillCategory.createMany({ data: missing.map((name, i) => ({ tenantId, name, createdAt: new Date(now + i) })) });
    });
    return this.list(tenantId, true);
  }

  async rename(tenantId: string, id: string, name: string): Promise<SkillCategoryItem[]> {
    await this.unique(name, async () => {
      const { count } = await this.prisma.skillCategory.updateMany({ where: { id, tenantId }, data: { name } });
      if (count === 0) throw categoryNotFound();
    });
    return this.list(tenantId, true);
  }

  /** 删除分类：使用它的 Skill 变为未分类 */
  async remove(tenantId: string, id: string): Promise<void> {
    const { count } = await this.prisma.skillCategory.deleteMany({ where: { id, tenantId } });
    if (count === 0) throw categoryNotFound();
  }

  private async unique(name: string, write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException(`分类「${name}」已存在`);
      throw err;
    }
  }
}
