import type { FamilyRole, Prisma } from '@prisma/client';

/**
 * 条目可见性过滤（查询层）。
 * 关键点：无权限的条目在 SQL 阶段就被排除，而不是查出来再判断，
 * 这样分页、计数、聚合都不会泄露「存在但你无权看」的条目。
 */
export function itemVisibilityWhere(userId: string, role: FamilyRole): Prisma.ItemWhereInput {
  const privileged = role === 'owner' || role === 'admin';
  const clauses: Prisma.ItemWhereInput[] = [{ createdBy: userId }, { shares: { some: { userId } } }];
  if (privileged) {
    clauses.push({});
  } else {
    clauses.push({
      visibility: { in: ['family', 'link'] },
      status: { in: ['published', 'archived'] },
    });
  }
  return { OR: clauses };
}

