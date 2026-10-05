import type { NextFunction, Request, Response } from 'express';
import type { User as PrismaUser } from '@prisma/client';
import { prisma } from '../db';
import { unauthenticated } from '../http/errors';
import { AppError } from '../http/errors';
import { verifyAccessToken } from '../services/tokenService';

function bearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * <img>/<audio> 这类标签无法携带 Authorization 头，因此允许媒体 GET 请求
 * 通过 ?t=<access token> 传递凭证。仅限 GET 且路径包含 /media/，
 * 避免把令牌通道扩大到普通接口（令牌仍会出现在 access log 中，属已知取舍）。
 */
function mediaQueryToken(req: Request): string | null {
  if (req.method !== 'GET') return null;
  if (!req.path.includes('/media/')) return null;
  const token = req.query.t;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/** 解析 access token 并加载用户；被停用的账号即使 token 未过期也会被拒。 */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearer(req) ?? mediaQueryToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return next();
    if (user.status === 'disabled') return next(new AppError('UNAUTHENTICATED', '账号已停用'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthenticated());
  next();
}

export function currentUser(req: Request): PrismaUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

export function clientMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 300) ?? null,
  };
}
