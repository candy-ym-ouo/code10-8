import { Router } from 'express';
import { createShareLinkSchema } from '@heirloom/shared';
import { asyncHandler } from '../http/asyncHandler';
import { clientMeta, currentUser } from '../middleware/auth';
import { familyCtx, requireFamily } from '../middleware/family';
import { writeLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';
import * as shareService from '../services/shareService';

export const shareLinksRouter = Router({ mergeParams: true });

shareLinksRouter.post(
  '/',
  requireFamily('share:manage'),
  writeLimiter,
  validateBody(createShareLinkSchema),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    const link = await shareService.createShareLink(user.id, ctx, req.body, clientMeta(req));
    res.status(201).json({ shareLink: link });
  }),
);

shareLinksRouter.get(
  '/',
  requireFamily('share:manage'),
  asyncHandler(async (req, res) => {
    const ctx = familyCtx(req);
    res.json({ shareLinks: await shareService.listShareLinks(ctx) });
  }),
);

shareLinksRouter.delete(
  '/:linkId',
  requireFamily('share:manage'),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    await shareService.revokeShareLink(user.id, ctx, req.params.linkId!, clientMeta(req));
    res.status(204).end();
  }),
);

