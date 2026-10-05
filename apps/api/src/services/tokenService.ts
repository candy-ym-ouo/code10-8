import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { AppError, unauthenticated } from '../http/errors';
import { randomToken, sha256Hex } from '../utils/crypto';

export const REFRESH_COOKIE = 'hl_refresh';
export const CSRF_COOKIE = 'hl_csrf';

export interface AccessPayload {
  sub: string;
  sysadmin: boolean;
}

export function signAccessToken(user: Pick<User, 'id' | 'systemRole'>): string {
  return jwt.sign({ sysadmin: user.systemRole === 'sysadmin' } satisfies Omit<AccessPayload, 'sub'>, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: config.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (typeof decoded === 'string' || !decoded.sub) throw unauthenticated();
    return { sub: decoded.sub, sysadmin: Boolean((decoded as jwt.JwtPayload).sysadmin) };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError('TOKEN_EXPIRED', '登录已过期');
    throw unauthenticated('登录凭证无效');
  }
}

function ttlToMs(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 14 * 24 * 3600 * 1000;
  const value = Number(m[1]);
  const unit = m[2];
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return value * factor;
}

export interface IssuedRefresh {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function issueRefreshToken(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<IssuedRefresh> {
  const token = randomToken(32);
  const csrfToken = randomToken(16);
  const expiresAt = new Date(Date.now() + ttlToMs(config.REFRESH_TOKEN_TTL));
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return { token, csrfToken, expiresAt };
}

/**
 * 轮换 refresh token 并做复用检测：
 * 如果收到一个「已撤销」的 token，说明它可能被窃取并重放，此时撤销该用户全部会话。
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ userId: string; refresh: IssuedRefresh }> {
  const tokenHash = sha256Hex(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!existing) throw unauthenticated('会话不存在，请重新登录');

  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthenticated('检测到会话复用，已撤销全部登录状态，请重新登录');
  }
  if (existing.expiresAt.getTime() < Date.now()) throw unauthenticated('会话已过期，请重新登录');
  if (existing.user.status === 'disabled') throw unauthenticated('账号已停用');

  await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  const refresh = await issueRefreshToken(existing.userId, meta);
  return { userId: existing.userId, refresh };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256Hex(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export function cookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlToMs(config.REFRESH_TOKEN_TTL),
  };
}

export function csrfCookieOptions(): Omit<ReturnType<typeof cookieOptions>, 'httpOnly'> & { httpOnly: boolean } {
  return { ...cookieOptions(), httpOnly: false };
}

