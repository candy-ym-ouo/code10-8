import type { FamilyRole, Item, ItemShare, Prisma } from '@prisma/client';
import { itemAccess, roleCan, type Action, type ItemAccess } from '@heirloom/shared';
import { prisma } from '../db';
import { forbidden, notFound } from '../http/errors';

export interface FamilyContext {
  familyId: string;
  role: FamilyRole;
  memberId: string;
}

export async function loadFamilyContext(userId: string, familyId: string): Promise<FamilyContext | null> {
  const membership = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId } },
    include: { family: true },
  });
  if (!membership || membership.status !== 'active' || membership.family.deletedAt) return null;
  return { familyId, role: membership.role, memberId: membership.id };
}

/** 家庭级权限断言：唯一入口，路由层不允许自己写角色判断。 */
export async function requireFamilyAction(userId: string, familyId: string, action: Action): Promise<FamilyContext> {
  const ctx = await loadFamilyContext(userId, familyId);
  // 不属于该家庭时返回 404，避免暴露家庭是否存在
  if (!ctx) throw notFound('家庭不存在或你不是该家庭成员');
  if (!roleCan(ctx.role, action)) throw forbidden();
  return ctx;
}

export interface ItemWithAccess {
  item: Item;
  access: ItemAccess;
  share: ItemShare | null;
}

export async function itemWithAccess(
  userId: string,
  ctx: FamilyContext,
  itemId: string,
  opts: { optionalShare?: Prisma.ItemShareInclude } = {},
): Promise<ItemWithAccess> {
  const item = await prisma.item.findFirst({
    where: { id: itemId, familyId: ctx.familyId },
    include: { shares: { where: { userId } } },
  });
  if (!item) throw notFound('条目不存在');

  const share = item.shares[0] ?? null;
  const access = itemAccess({
    role: ctx.role,
    userId,
    createdBy: item.createdBy,
    status: item.status,
    visibility: item.visibility,
    sharedWithMe: share ? { canEdit: share.canEdit } : null,
  });

  void opts;
  if (!access.canRead) throw notFound('条目不存在');
  return { item, access, share };
}

export function assertCan(access: ItemAccess, key: keyof ItemAccess, message = '没有权限执行该操作'): void {
  if (!access[key]) throw forbidden(message);
}

