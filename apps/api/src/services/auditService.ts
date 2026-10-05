import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditInput {
  familyId?: string | null;
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  diff?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * 审计写入。所有写操作都必须在同一事务里调用它，保证「改了但没记录」不可能发生。
 */
export async function record(input: AuditInput, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      familyId: input.familyId ?? null,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      diff: (input.diff ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

/** 审计失败不应掩盖主流程错误，用于无法纳入事务的旁路场景。 */
export async function recordSoft(input: AuditInput): Promise<void> {
  try {
    await record(input);
  } catch (err) {
    logger.error({ err, action: input.action }, '审计写入失败');
  }
}

export function diffOf(before: unknown, after: unknown): Prisma.InputJsonValue {
  return { before, after } as unknown as Prisma.InputJsonValue;
}

