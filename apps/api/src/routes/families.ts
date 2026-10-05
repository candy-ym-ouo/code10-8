import { Router } from 'express';
import {
  createFamilySchema,
  createInviteSchema,
  deleteFamilySchema,
  updateFamilySchema,
  updateMemberSchema,
} from '@heirloom/shared';
import { asyncHandler } from '../http/asyncHandler';
import { clientMeta, currentUser, requireAuth } from '../middleware/auth';
import { familyCtx, requireFamily } from '../middleware/family';
import { writeLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';
import * as familyService from '../services/familyService';
import { listMemberships } from '../services/authService';
import { timeline } from '../services/itemService';
import { prisma } from '../db';

export const familiesRouter = Router();

familiesRouter.use(requireAuth);

familiesRouter.post(
  '/',
  writeLimiter,
  validateBody(createFamilySchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const family = await familyService.createFamily(user.id, req.body, clientMeta(req));
    res.status(201).json({ family });
  }),
);

familiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({ memberships: await listMemberships(user.id) });
  }),
);

familiesRouter.get(
  '/:fid',
  requireFamily('family:read'),
  asyncHandler(async (req, res) => {
    const ctx = familyCtx(req);
    const family = await familyService.getFamilyDetail(ctx.familyId);
    const role = ctx.role;
    res.json({
      family: {
        id: family.id,
        name: family.name,
        description: family.description,
        defaultVisibility: family.defaultVisibility,
        allowViewerComment: family.allowViewerComment,
        createdAt: family.createdAt.toISOString(),
        counts: family._count,
      },
      myRole: role,
    });
  }),
);

familiesRouter.patch(
  '/:fid',
  requireFamily('family:update'),
  writeLimiter,
  validateBody(updateFamilySchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    const family = await familyService.updateFamily(user.id, ctx.familyId, req.body, clientMeta(req));
    res.json({ family });
  }),
);

familiesRouter.delete(
  '/:fid',
  requireFamily('family:delete'),
  writeLimiter,
  validateBody(deleteFamilySchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    await familyService.deleteFamily(user.id, ctx.familyId, req.body.confirmName, clientMeta(req));
    res.status(204).end();
  }),
);

familiesRouter.get(
  '/:fid/members',
  requireFamily('member:read'),
  asyncHandler(async (req, res) => {
    const ctx = familyCtx(req);
    res.json({ members: await familyService.listMembers(ctx.familyId, true) });
  }),
);

familiesRouter.patch(
  '/:fid/members/:userId',
  requireFamily('member:manage'),
  writeLimiter,
  validateBody(updateMemberSchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    const targetUserId = req.params.userId!;
    if (req.body.op === 'role') {
      await familyService.updateMemberRole(
        { id: user.id, role: ctx.role },
        ctx.familyId,
        targetUserId,
        req.body.role,
        clientMeta(req),
      );
    } else {
      await familyService.setMemberStatus(
        { id: user.id, role: ctx.role },
        ctx.familyId,
        targetUserId,
        req.body.op === 'disable' ? 'disabled' : 'active',
        clientMeta(req),
      );
    }
    res.json({ members: await familyService.listMembers(ctx.familyId, true) });
  }),
);

familiesRouter.delete(
  '/:fid/members/:userId',
  requireFamily('member:manage'),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    await familyService.removeMember({ id: user.id, role: ctx.role }, ctx.familyId, req.params.userId!, clientMeta(req));
    res.status(204).end();
  }),
);

familiesRouter.post(
  '/:fid/invites',
  requireFamily('invite:manage'),
  writeLimiter,
  validateBody(createInviteSchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    const invite = await familyService.createInvite(user.id, ctx.role, ctx.familyId, req.body, clientMeta(req));
    res.status(201).json({
      invite: {
        id: invite.id,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
        maxUses: invite.maxUses,
        note: invite.note,
        code: invite.code,
        url: `/join/${invite.code}`,
      },
    });
  }),
);

familiesRouter.get(
  '/:fid/invites',
  requireFamily('invite:manage'),
  asyncHandler(async (req, res) => {
    const ctx = familyCtx(req);
    const invites = await familyService.listInvites(ctx.familyId);
    res.json({
      invites: invites.map((i) => ({
        id: i.id,
        role: i.role,
        note: i.note,
        expiresAt: i.expiresAt.toISOString(),
        maxUses: i.maxUses,
        usedCount: i.usedCount,
        revokedAt: i.revokedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
    });
  }),
);

familiesRouter.delete(
  '/:fid/invites/:inviteId',
  requireFamily('invite:manage'),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    await familyService.revokeInvite(user.id, ctx.familyId, req.params.inviteId!, clientMeta(req));
    res.status(204).end();
  }),
);

familiesRouter.get(
  '/:fid/timeline',
  requireFamily('family:read'),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    res.json({ groups: await timeline(user.id, ctx) });
  }),
);

familiesRouter.get(
  '/:fid/stats',
  requireFamily('family:read'),
  asyncHandler(async (req, res) => {
    const ctx = familyCtx(req);
    const [byCategory, total, media, bytes, recent] = await Promise.all([
      prisma.item.groupBy({ by: ['category'], where: { familyId: ctx.familyId, status: { not: 'trashed' } }, _count: true }),
      prisma.item.count({ where: { familyId: ctx.familyId, status: { not: 'trashed' } } }),
      prisma.itemMedia.count({ where: { item: { familyId: ctx.familyId }, deletedAt: null } }),
      prisma.itemMedia.aggregate({ where: { item: { familyId: ctx.familyId }, deletedAt: null }, _sum: { byteSize: true } }),
      prisma.item.count({
        where: { familyId: ctx.familyId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      }),
    ]);
    res.json({
      totalItems: total,
      totalMedia: media,
      totalBytes: Number(bytes._sum.byteSize ?? 0),
      recentItems: recent,
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count })),
    });
  }),
);

familiesRouter.get(
  '/:fid/audit-logs',
  requireFamily('audit:read'),
  asyncHandler(async (req, res) => {
    const ctx = familyCtx(req);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 60)));
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const logs = await prisma.auditLog.findMany({
      where: { familyId: ctx.familyId, action },
      include: { actor: { select: { id: true, displayName: true, avatarColor: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        diff: l.diff,
        ip: l.ip,
        createdAt: l.createdAt.toISOString(),
        actor: l.actor,
      })),
    });
  }),
);
