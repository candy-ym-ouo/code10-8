import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { badRequest } from '../http/errors';

export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(badRequest('请求参数不合法', parsed.error.flatten()));
    }
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return next(badRequest('查询参数不合法', parsed.error.flatten()));
    }
    // 校验后的值挂在 req 上，避免污染只读的 req.query
    (req as Request & { validatedQuery?: unknown }).validatedQuery = parsed.data;
    next();
  };
}

export function queryOf<T>(req: Request): T {
  return (req as Request & { validatedQuery?: unknown }).validatedQuery as T;
}

