import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Action } from '@heirloom/shared';
import { requireFamilyAction } from '../services/permissionService';
import { currentUser } from './auth';

/**
 * 把「加载家庭上下文 + 校验家庭级权限」固化成中间件，
 * 路由层不再自己写角色判断，避免权限逻辑散落。
 */
export function requireFamily(action: Action): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = currentUser(req);
      const familyId = req.params.fid ?? req.params.familyId;
      if (!familyId) throw new Error('路由缺少 familyId 参数');
      req.familyCtx = await requireFamilyAction(user.id, familyId, action);
      req.familyRole = req.familyCtx.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function familyCtx(req: Request) {
  if (!req.familyCtx) throw new Error('家庭上下文未初始化');
  return req.familyCtx;
}

