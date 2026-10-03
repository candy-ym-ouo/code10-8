import {
  classifyProgressTrend,
  defaultMetricDirectionForType,
  isTargetReached,
  missingGoalEvidence,
  type MetricDirection,
  type MetricType,
  type ProgressTrend,
} from "@practice/contracts";
import type { Prisma } from "@prisma/client";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export const goalInclude = {
  sourceSession: { select: { id: true, title: true, instrument: true, startedAt: true } },
  annotation: true,
  progresses: {
    orderBy: { recordedAt: "desc" as const },
    include: {
      session: { select: { id: true, title: true, startedAt: true } },
      evidenceMedia: { select: { id: true, originalName: true, status: true } },
    },
  },
} satisfies Prisma.GoalInclude;

export function resolveMetricDirection(
  metricType: MetricType,
  metricDirection?: MetricDirection | null,
): MetricDirection {
  return metricDirection ?? defaultMetricDirectionForType(metricType);
}

/**
 * 进度必须满足目标的证据要求；同一练习重复记录时只能追加，并要求填写修订原因。
 */
async function assertProgressInput(tx: Prisma.TransactionClient, input: {
  goal: Pick<Prisma.GoalGetPayload<Record<string, never>>, "id" | "evidenceRequirement">;
  sessionId: string;
  evidenceMediaId?: string | null;
  note?: string | null;
  revisionReason?: string | null;
}): Promise<void> {
  const missingEvidence = missingGoalEvidence({
    evidenceRequirement: input.goal.evidenceRequirement,
    evidenceMediaId: input.evidenceMediaId,
    note: input.note,
    revisionReason: input.revisionReason,
  });
  if (missingEvidence.length > 0) {
    throw new AppError(400, "GOAL_EVIDENCE_REQUIRED", "目标证据要求未满足", missingEvidence);
  }
  const duplicateCount = await tx.goalProgress.count({
    where: { goalId: input.goal.id, sessionId: input.sessionId },
  });
  if (duplicateCount > 0 && !input.revisionReason?.trim()) {
    throw new AppError(
      409,
      "REVISION_REASON_REQUIRED",
      "该练习已有进度记录，重复记录会追加保留，请填写修订原因后再提交",
    );
  }
}

/**
 * 追加一条进度，并按指标方向把目标推进到 IN_PROGRESS / ACHIEVED。
 * 已有进度永不覆盖，趋势由相邻两次记录按指标方向实时推导。
 */
export async function appendGoalProgress(tx: Prisma.TransactionClient, input: {
  userId: string;
  goal: Prisma.GoalGetPayload<Record<string, never>>;
  sessionId: string;
  actualValue: number;
  note?: string | null;
  evidenceMediaId?: string | null;
  revisionReason?: string | null;
  recordedAt?: Date;
}): Promise<{ progressId: string; trend: ProgressTrend; targetReached: boolean }> {
  await assertProgressInput(tx, {
    goal: input.goal,
    sessionId: input.sessionId,
    evidenceMediaId: input.evidenceMediaId,
    note: input.note,
    revisionReason: input.revisionReason,
  });

  const previous = await tx.goalProgress.findFirst({
    where: { goalId: input.goal.id },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
    select: { actualValue: true },
  });
  const created = await tx.goalProgress.create({
    data: {
      userId: input.userId,
      goalId: input.goal.id,
      sessionId: input.sessionId,
      actualValue: input.actualValue,
      note: input.note ?? null,
      evidenceMediaId: input.evidenceMediaId ?? null,
      revisionReason: input.revisionReason ?? null,
      recordedAt: input.recordedAt ?? new Date(),
    },
    select: { id: true },
  });

  const targetReached = isTargetReached({
    actualValue: input.actualValue,
    targetValue: Number(input.goal.targetValue),
    metricDirection: input.goal.metricDirection,
  });
  if (targetReached) {
    await tx.goal.update({
      where: { id: input.goal.id },
      data: { status: "ACHIEVED", completedAt: new Date(), version: { increment: 1 } },
    });
  } else if (input.goal.status === "OPEN") {
    await tx.goal.update({
      where: { id: input.goal.id },
      data: { status: "IN_PROGRESS", version: { increment: 1 } },
    });
  }

  const trend = classifyProgressTrend({
    currentValue: input.actualValue,
    previousValue: previous ? Number(previous.actualValue) : null,
    metricDirection: input.goal.metricDirection,
  });
  return { progressId: created.id, trend, targetReached };
}

/**
 * 用户显式确认达成：状态口径与逾期扫描一致，只接受 OPEN/IN_PROGRESS。
 * 最近一次测量未达标仍要确认时，必须填写修订/豁免原因。
 */
export async function confirmGoalAchieved(userId: string, goalId: string, revisionReason?: string | null) {
  const existing = await prisma.goal.findFirst({ where: { id: goalId, userId } });
  if (!existing) throw notFound();
  if (!["OPEN", "IN_PROGRESS"].includes(existing.status)) {
    throw new AppError(409, "INVALID_GOAL_STATE", "只有待开始或进行中的目标可以确认达成，逾期目标请先重新激活");
  }

  const latestProgress = await prisma.goalProgress.findFirst({
    where: { goalId, userId },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
  });
  const missingEvidence = missingGoalEvidence({
    evidenceRequirement: existing.evidenceRequirement,
    evidenceMediaId: latestProgress?.evidenceMediaId,
    note: latestProgress?.note,
    revisionReason,
  });
  if (missingEvidence.length > 0) {
    throw new AppError(400, "GOAL_EVIDENCE_REQUIRED", "目标证据要求未满足", missingEvidence);
  }
  const reached = latestProgress
    ? isTargetReached({
        actualValue: Number(latestProgress.actualValue),
        targetValue: Number(existing.targetValue),
        metricDirection: existing.metricDirection,
      })
    : false;
  if (!reached && !revisionReason?.trim()) {
    throw new AppError(
      409,
      "REVISION_REASON_REQUIRED",
      "最近一次测量尚未达到目标值，确认达成需填写修订或豁免原因",
    );
  }

  return prisma.goal.update({
    where: { id: goalId },
    data: { status: "ACHIEVED", completedAt: new Date(), version: { increment: 1 } },
    include: goalInclude,
  });
}
