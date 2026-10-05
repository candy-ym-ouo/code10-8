import type { FamilyRole, Prisma } from '@prisma/client';
import { canAssignRole, canManageMember } from '@heirloom/shared';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { randomToken, sha256Hex } from '../utils/crypto';
import * as audit from './auditService';
import { toMemberDto } from '../serializers';

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export const familyDetailInclude = {
  _count: { select: { members: true, items: true, people: true } },
} satisfies Prisma.FamilyInclude;

export async function createFamily(
  userId: string,
  input: { name: string; description?: string | null; defaultVisibility?: 'private' | 'family' | 'selected' | 'link' },
  meta: ActorMeta,
) {
  return prisma.$transaction(async (tx) => {
    const family = await tx.family.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        defaultVisibility: input.defaultVisibility ?? 'family',
        createdBy: userId,
      },
    });
    await tx.familyMember.create({ data: { familyId: family.id, userId, role: 'owner' } });
    await audit.record(
      {
        familyId: family.id,
        actorId: userId,
        action: 'family.create',
        targetType: 'family',
        targetId: family.id,
        diff: { name: family.name } as Prisma.InputJsonValue,
        ...meta,
      },
      tx,
    );
    return family;
  });
}

export async function getFamilyDetail(familyId: string) {
  const family = await prisma.family.findFirst({
    where: { id: familyId, deletedAt: null },
    include: familyDetailInclude,
  });
  if (!family) throw notFound('家庭不存在');
  return family;
}

export async function updateFamily(
  actorId: string,
  familyId: string,
  input: { name?: string; description?: string | null; defaultVisibility?: 'private' | 'family' | 'selected' | 'link'; allowViewerComment?: boolean },
  meta: ActorMeta,
) {
  const before = await getFamilyDetail(familyId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.family.update({
      where: { id: familyId },
      data: {
        name: input.name ?? undefined,
        description: input.description === undefined ? undefined : input.description,
        defaultVisibility: input.defaultVisibility ?? undefined,
        allowViewerComment: input.allowViewerComment ?? undefined,
      },
    });
    await audit.record(
      {
        familyId,
        actorId,
        action: 'family.update',
        targetType: 'family',
        targetId: familyId,
        diff: audit.diffOf(
          { name: before.name, description: before.description, defaultVisibility: before.defaultVisibility },
          { name: updated.name, description: updated.description, defaultVisibility: updated.defaultVisibility },
        ),
        ...meta,
      },
      tx,
    );
    return updated;
  });
}

export async function deleteFamily(actorId: string, familyId: string, confirmName: string, meta: ActorMeta) {
  const family = await getFamilyDetail(familyId);
  if (family.name !== confirmName) throw badRequest('家庭名不匹配，删除已取消');
  await prisma.$transaction(async (tx) => {
    await tx.family.update({ where: { id: familyId }, data: { deletedAt: new Date() } });
    await audit.record(
      { familyId, actorId, action: 'family.delete', targetType: 'family', targetId: familyId, ...meta },
      tx,
    );
  });
}

export async function listMembers(familyId: string, includeDisabled = false) {
  const members = await prisma.familyMember.findMany({
    where: { familyId, status: includeDisabled ? undefined : 'active' },
    include: { user: { select: { id: true, email: true, displayName: true, avatarColor: true } } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
  return members.map(toMemberDto);
}

export async function updateMemberRole(
  actor: { id: string; role: FamilyRole },
  familyId: string,
  targetUserId: string,
  role: FamilyRole,
  meta: ActorMeta,
) {
  const target = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId: targetUserId } },
  });
  if (!target) throw notFound('成员不存在');
  if (!canManageMember(actor.role, target.role)) throw forbidden('你不能修改该成员的权限');
  if (!canAssignRole(actor.role, role)) throw forbidden('你不能授予该角色');
  if (target.role === 'owner') throw forbidden('不能修改家庭创建者的角色');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.familyMember.update({
      where: { familyId_userId: { familyId, userId: targetUserId } },
      data: { role, status: 'active' },
    });
    await audit.record(
      {
        familyId,
        actorId: actor.id,
        action: 'member.update_role',
        targetType: 'user',
        targetId: targetUserId,
        diff: audit.diffOf({ role: target.role, status: target.status }, { role, status: 'active' }),
        ...meta,
      },
      tx,
    );
    return updated;
  });
}

export async function setMemberStatus(
  actor: { id: string; role: FamilyRole },
  familyId: string,
  targetUserId: string,
  status: 'active' | 'disabled',
  meta: ActorMeta,
) {
  const target = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId: targetUserId } },
  });
  if (!target) throw notFound('成员不存在');
  if (!canManageMember(actor.role, target.role)) throw forbidden('你不能修改该成员的状态');

  await prisma.$transaction(async (tx) => {
    await tx.familyMember.update({
      where: { familyId_userId: { familyId, userId: targetUserId } },
      data: { status },
    });
    if (status === 'disabled') {
      await tx.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await audit.record(
      {
        familyId,
        actorId: actor.id,
        action: 'member.update_role',
        targetType: 'user',
        targetId: targetUserId,
        diff: audit.diffOf({ status: target.status }, { status }),
        ...meta,
      },
      tx,
    );
  });
}

export async function removeMember(
  actor: { id: string; role: FamilyRole },
  familyId: string,
  targetUserId: string,
  meta: ActorMeta,
) {
  const target = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId: targetUserId } },
  });
  if (!target) throw notFound('成员不存在');
  if (!canManageMember(actor.role, target.role)) throw forbidden('你不能移除该成员');

  await prisma.$transaction(async (tx) => {
    await tx.familyMember.delete({ where: { familyId_userId: { familyId, userId: targetUserId } } });
    // 清掉该成员在这个家庭里的条目级授权，避免残留
    await tx.itemShare.deleteMany({ where: { userId: targetUserId, item: { familyId } } });
    // 会话与家庭无关，直接撤销该用户全部登录态，保证被移除后立即失效
    await tx.refreshToken.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit.record(
      {
        familyId,
        actorId: actor.id,
        action: 'member.remove',
        targetType: 'user',
        targetId: targetUserId,
        diff: { role: target.role } as Prisma.InputJsonValue,
        ...meta,
      },
      tx,
    );
  });
}

export async function createInvite(
  actorId: string,
  actorRole: FamilyRole,
  familyId: string,
  input: { role: FamilyRole; expiresInDays: number; maxUses: number; note?: string | null },
  meta: ActorMeta,
) {
  if (!canAssignRole(actorRole, input.role)) throw forbidden('你不能邀请为该角色');
  const code = randomToken(18);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);

  const invite = await prisma.$transaction(async (tx) => {
    const created = await tx.invite.create({
      data: {
        familyId,
        codeHash: sha256Hex(code),
        role: input.role,
        note: input.note ?? null,
        expiresAt,
        maxUses: input.maxUses,
        createdBy: actorId,
      },
    });
    await audit.record(
      {
        familyId,
        actorId,
        action: 'member.invite',
        targetType: 'invite',
        targetId: created.id,
        diff: { role: input.role, maxUses: input.maxUses } as Prisma.InputJsonValue,
        ...meta,
      },
      tx,
    );
    return created;
  });

  // 明文只在这里返回一次，库里只有 hash
  return { ...invite, code };
}

export async function listInvites(familyId: string) {
  return prisma.invite.findMany({ where: { familyId }, orderBy: { createdAt: 'desc' }, take: 100 });
}

export async function revokeInvite(actorId: string, familyId: string, inviteId: string, meta: ActorMeta) {
  const invite = await prisma.invite.findFirst({ where: { id: inviteId, familyId } });
  if (!invite) throw notFound('邀请不存在');
  await prisma.$transaction(async (tx) => {
    await tx.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    await audit.record(
      { familyId, actorId, action: 'member.invite', targetType: 'invite', targetId: inviteId, diff: { revoked: true } as Prisma.InputJsonValue, ...meta },
      tx,
    );
  });
}

export async function previewInvite(code: string) {
  const invite = await prisma.invite.findUnique({
    where: { codeHash: sha256Hex(code) },
    include: { family: { select: { id: true, name: true, description: true } } },
  });
  if (!invite) throw notFound('邀请链接无效');
  if (invite.revokedAt) throw conflict('邀请已被撤销');
  if (invite.expiresAt.getTime() < Date.now()) throw conflict('邀请已过期');
  if (invite.usedCount >= invite.maxUses) throw conflict('邀请使用次数已用尽');
  return {
    familyId: invite.familyId,
    familyName: invite.family.name,
    familyDescription: invite.family.description,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    remainingUses: invite.maxUses - invite.usedCount,
  };
}

export async function acceptInvite(userId: string, code: string, meta: ActorMeta) {
  const invite = await prisma.invite.findUnique({ where: { codeHash: sha256Hex(code) } });
  if (!invite) throw notFound('邀请链接无效');
  if (invite.revokedAt) throw conflict('邀请已被撤销');
  if (invite.expiresAt.getTime() < Date.now()) throw conflict('邀请已过期');
  if (invite.usedCount >= invite.maxUses) throw conflict('邀请使用次数已用尽');

  const existing = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId: invite.familyId, userId } },
  });
  if (existing) {
    return { familyId: invite.familyId, role: existing.role, alreadyMember: true };
  }

  return prisma.$transaction(async (tx) => {
    // 条件更新兜住并发：只有 used_count < max_uses 时才 +1
    const bumped = await tx.invite.updateMany({
      where: { id: invite.id, usedCount: { lt: invite.maxUses }, revokedAt: null },
      data: { usedCount: { increment: 1 } },
    });
    if (bumped.count === 0) throw conflict('邀请使用次数已用尽');

    await tx.familyMember.create({
      data: { familyId: invite.familyId, userId, role: invite.role },
    });
    await audit.record(
      {
        familyId: invite.familyId,
        actorId: userId,
        action: 'member.join',
        targetType: 'user',
        targetId: userId,
        diff: { role: invite.role } as Prisma.InputJsonValue,
        ...meta,
      },
      tx,
    );
    return { familyId: invite.familyId, role: invite.role, alreadyMember: false };
  });
}

