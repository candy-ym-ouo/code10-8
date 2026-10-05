import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** 把 async 路由的 reject 转交给统一错误处理中间件（Express 4 不会自动接住）。 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next).catch(next);
  };

