import { Router } from 'express';
import { asyncHandler } from '../http/asyncHandler';
import { clientMeta, currentUser, requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import * as familyService from '../services/familyService';

export const invitesRouter = Router();

/** 落地页用：未登录也能看到「谁邀请你、进哪个家庭、什么角色」。 */
invitesRouter.get(
  '/:code',
  authLimiter,
  asyncHandler(async (req, res) => {
    res.json({ invite: await familyService.previewInvite(req.params.code!) });
  }),
);

invitesRouter.post(
  '/:code/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const result = await familyService.acceptInvite(user.id, req.params.code!, clientMeta(req));
    res.json(result);
  }),
);

