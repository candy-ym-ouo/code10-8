import { Prisma, PrismaClient } from "@prisma/client";
import {
  classifyProgressTrend,
  isGoalProgressValid,
  type MetricDirection,
} from "@practice/contracts";
import { AppError } from "./errors.js";

type ProgressClient = Prisma.TransactionClient | PrismaClient;

interface GoalForProgress {
  id: string;
  status: string;
  targetValue: Prisma.Decimal;
  metricDirection: MetricDirection;
  evidenceRequirement?: "NONE" | "AUDIO" | "SELF_REVIEW" | "AUDIO_AND_SELF_REVIEW";
}

/** 按目标的证据要求校验进度记录：要求音频时必须附带已就绪证据，要求自评时必须填写备注。 */
export function assertProgressEvidence(
  goal: Pick<GoalForProgress, "evidenceRequirement">,
  input: { evidenceMediaId?: string | null; note?: string | null },
): void {
  const requirement = goal.evidenceRequirement ?? "NONE";
  if ((requirement === "AUDIO" || requirement === "AUDIO_AND_SELF_REVIEW") && !input.evidenceMediaId) {
    throw new AppError(400, "EVIDENCE_REQUIRED", "该目标要求音频证据，请选择本次练习的证据音频");
  }
  if ((requirement === "SELF_REVIEW" || requirement === "AUDIO_AND_SELF_REVIEW") && !input.note?.trim()) {
    throw new AppError(400, "EVIDENCE_REQUIRED", "该目标要求自评说明，请填写进度备注");
  }
}

/**
 * 写入一条进度，并按指标方向判定趋势：
 * - 趋势来自同一目标上一条进度（recordedAt 更早），首次记录为 null；
 * - 重复记录始终 INSERT 新行，历史进度和证据永不覆盖；
 * - OPEN 目标在首次记录进度后进入 IN_PROGRESS；
 * - 按指标方向达到目标值时自动确认达成（幂等，重复达标记录不会重复关闭）。
 */
export async function recordGoalProgress(
  tx: ProgressClient,
  client: {
    userId: string;
    goal: GoalForProgress;
    sessionId: string;
    actualValue: number;
    note?: string | null;
    evidenceMediaId?: string | null;
    recordedAt?: Date;
  },
) {
  const { userId, goal, sessionId } = client;
  const previous = await tx.goalProgress.findFirst({
    where: { goalId: goal.id, userId },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
    select: { actualValue: true, recordedAt: true },
  });
  const recordedAt = client.recordedAt ?? new Date();
  const trend = classifyProgressTrend({
    current: client.actualValue,
    previous: previous ? Number(previous.actualValue) : null,
    direction: goal.metricDirection,
  });

  const progress = await tx.goalProgress.create({
    data: {
      userId,
      goalId: goal.id,
      sessionId,
      actualValue: client.actualValue,
      note: client.note ?? null,
      evidenceMediaId: client.evidenceMediaId ?? null,
      trend,
      recordedAt,
    },
  });

  const reachedTarget = isGoalProgressValid(
    client.actualValue,
    Number(goal.targetValue),
    goal.metricDirection,
  );
  if (reachedTarget && goal.status !== "ACHIEVED") {
    await tx.goal.update({
      where: { id: goal.id },
      data: { status: "ACHIEVED", completedAt: recordedAt, version: { increment: 1 } },
    });
  } else if (goal.status === "OPEN") {
    await tx.goal.update({
      where: { id: goal.id },
      data: { status: "IN_PROGRESS", version: { increment: 1 } },
    });
  }
  return progress;
}

/**
 * 用户手动确认达成时的统一校验：
 * 目标必须处于活动状态，且至少有一条按指标方向达标的进度记录；
 * 已经是 ACHIEVED 时保持幂等，不重复写入 completedAt。
 */
export async function assertGoalCanComplete(tx: ProgressClient, goal: GoalForProgress): Promise<void> {
  if (goal.status === "CANCELLED") {
    throw new AppError(409, "INVALID_GOAL_STATE", "已取消目标不能确认达成");
  }
  if (goal.status === "ACHIEVED") {
    throw new AppError(409, "INVALID_GOAL_STATE", "目标已确认达成，不能重复确认");
  }
  const matching = await tx.goalProgress.findMany({
    where: { goalId: goal.id },
    orderBy: { recordedAt: "desc" },
    select: { actualValue: true },
  });
  const reached = matching.some((item) =>
    isGoalProgressValid(Number(item.actualValue), Number(goal.targetValue), goal.metricDirection),
  );
  if (!reached) {
    throw new AppError(
      409,
      "GOAL_NOT_REACHED",
      "还没有按指标方向达到目标值的进度记录，不能确认达成",
    );
  }
}

/** 记录修订原因（重新激活、调整目标值等），与状态变更在同一更新中落库。 */
export function revisionData(reason?: string | null): { revisionReason: string | null } {
  return { revisionReason: reason?.trim() ? reason.trim().slice(0, 1000) : null };
}
