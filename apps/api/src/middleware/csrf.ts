import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { AppError } from '../http/errors';
import { CSRF_COOKIE, REFRESH_COOKIE } from '../services/tokenService';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 允许的来源：
 *  1. 与请求 Host 完全一致（同源部署，也是最常见的情况）
 *  2. 配置里的 APP_URL（前后端分离部署时）
 *  3. 开发环境额外的回环地址（Vite dev server 会以 5173 端口作为 Origin 反代到 API）
 * 生产环境不会放宽到第 3 条。
 */
export function isAllowedOrigin(origin: string, host: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (host && parsed.host === host) return true;
  try {
    if (parsed.origin === new URL(config.APP_URL).origin) return true;
  } catch {
    /* APP_URL 配置异常时忽略该条 */
  }
  if (!config.isProd && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return true;
  return false;
}

/**
 * 两层防护：
 *  1. Origin 校验：浏览器发起的跨站写请求一定带 Origin，与本站不符即拒绝。
 *  2. 双提交 Cookie：/auth/refresh 与 /auth/logout 依赖 Cookie 认证，必须带匹配的 X-CSRF-Token。
 * 非浏览器客户端（curl / 集成测试）不带 Origin，会被放行——CSRF 本就需要浏览器携带 Cookie 才能成立。
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.header('origin');
  if (origin) {
    if (!isAllowedOrigin(origin, req.header('host'))) {
      return next(new AppError('FORBIDDEN', '跨站请求已被拒绝'));
    }
  }

  // 注意：中间件挂在 /api/v1/auth 下时 req.path 只剩 /refresh，必须用 originalUrl 判断
  const path = (req.originalUrl.split('?')[0] ?? '').replace(/\/+$/, '');
  const needsDoubleSubmit = path.endsWith('/auth/refresh') || path.endsWith('/auth/logout');
  if (needsDoubleSubmit) {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.header('x-csrf-token');
  // 没有会话 Cookie 时无可保护对象：交给认证层返回 401，而不是让人误以为越权
  if (!req.cookies?.[REFRESH_COOKIE]) return next();
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new AppError('FORBIDDEN', 'CSRF 校验失败，请刷新页面后重试'));
  }
  }
  next();
}
