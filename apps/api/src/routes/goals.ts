import type { FastifyPluginAsync } from "fastify";
import {
  goalActivateSchema,
  goalCancelSchema,
  goalCreateSchema,
  goalListQuerySchema,
  goalProgressCreateSchema,
  goalUpdateSchema,
  hasGoalRevision,
  isGoalOverdue,
} from "@practice/contracts";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { parseOrThrow } from "../lib/validation.js";
import { audit } from "../lib/audit.js";
import { assertGoalCanComplete, assertProgressEvidence, recordGoalProgress, revisionData } from "../lib/goal-service.js";

const goalInclude = {
  sourceSession: { select: { id: true, title: true, instrument: true, startedAt: true } },
  annotation: true,
  progresses: {
    orderBy: { recordedAt: "desc" as const },
    include: {
      session: { select: { id: true, title: true, startedAt: true } },
      evidenceMedia: { select: { id: true, originalName: true, status: true } },
    },
  },
} as const;

const goalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = parseOrThrow(goalListQuerySchema, request.query);
    const data = await prisma.goal.findMany({
      where: {
        userId: request.authUser!.id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.dueBefore ? { dueDate: { lte: query.dueBefore } } : {}),
        ...(query.instrument ? { sourceSession: { instrument: query.instrument } } : {}),
      },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [
        { status: "asc" },
        { dueDate: "asc" },
        { createdAt: "desc" },
      ],
      include: goalInclude,
    });
    const hasMore = data.length > query.limit;
    const items = hasMore ? data.slice(0, query.limit) : data;
    return { data: items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  });

  app.post("/", async (request, reply) => {
    const input = parseOrThrow(goalCreateSchema, request.body);
    const source = await prisma.practiceSession.findFirst({
      where: { id: input.sourceSessionId, userId: request.authUser!.id },
      select: { id: true },
    });
    if (!source) throw notFound();
    if (input.annotationId) {
      const annotation = await prisma.annotation.findFirst({
        where: { id: input.annotationId, sessionId: source.id, userId: request.authUser!.id },
        select: { id: true },
      });
      if (!annotation) throw new AppError(400, "VALIDATION_ERROR", "关联标记不属于来源练习");
    }
    const goal = await prisma.goal.create({
      data: {
        userId: request.authUser!.id,
        sourceSessionId: input.sourceSessionId,
        annotationId: input.annotationId ?? null,
        title: input.title,
        category: input.category,
        metricType: input.metricType,
        metricDirection: input.metricDirection,
        baselineValue: input.baselineValue ?? null,
        targetValue: input.targetValue,
        unit: input.unit,
        dueDate: input.dueDate,
        method: input.method ?? null,
        evidenceRequirement: input.evidenceRequirement,
      },
      include: goalInclude,
    });
    return reply.status(201).send({ goal });
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const goal = await prisma.goal.findFirst({ where: { id, userId: request.authUser!.id }, include: goalInclude });
    if (!goal) throw notFound();
    return { goal };
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(goalUpdateSchema, request.body);
    const existing = await prisma.goal.findFirst({ where: { id, userId: request.authUser!.id } });
    if (!existing) throw notFound();
    if (input.annotationId) {
      const annotation = await prisma.annotation.findFirst({
        where: { id: input.annotationId, sessionId: existing.sourceSessionId, userId: request.authUser!.id },
        select: { id: true },
      });
      if (!annotation) throw new AppError(400, "VALIDATION_ERROR", "关联标记不属于来源练习");
    }
    const revising = hasGoalRevision(input);
    // MISSED 目标调整口径必须走重新激活，避免绕过逾期确认与修订原因留痕。
    if (existing.status === "MISSED" && revising) {
      throw new AppError(409, "GOAL_OVERDUE", "目标已逾期，请通过重新激活修订目标并填写修订原因");
    }
    const revisionReason = input.revisionReason?.trim() || "";
    if (revising && !revisionReason) {
      throw new AppError(400, "REVISION_REASON_REQUIRED", "调整指标或截止日期时必须填写修订原因");
    }
    const updated = await prisma.goal.updateMany({
      where: { id, userId: request.authUser!.id, version: input.version },
      data: {
        ...(input.annotationId === undefined ? {} : { annotationId: input.annotationId }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.metricType === undefined ? {} : { metricType: input.metricType }),
        ...(input.metricDirection === undefined ? {} : { metricDirection: input.metricDirection }),
        ...(input.baselineValue === undefined ? {} : { baselineValue: input.baselineValue }),
        ...(input.targetValue === undefined ? {} : { targetValue: input.targetValue }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
        ...(input.method === undefined ? {} : { method: input.method }),
        ...(input.evidenceRequirement === undefined ? {} : { evidenceRequirement: input.evidenceRequirement }),
        revisionReason: revising ? revisionReason.slice(0, 1000) : existing.revisionReason,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "目标已在其他窗口被修改");
    const goal = await prisma.goal.findUniqueOrThrow({ where: { id }, include: goalInclude });
    if (revising) await audit(request, "GOAL_REVISED", "GOAL", id, "SUCCESS", { revisionReason });
    return { goal };
  });

  app.post("/:id/activate", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(goalActivateSchema, request.body);
    const existing = await prisma.goal.findFirst({ where: { id, userId: request.authUser!.id } });
    if (!existing) throw notFound();
    if (!["MISSED", "CANCELLED"].includes(existing.status)) {
      throw new AppError(409, "INVALID_GOAL_STATE", "只有已逾期或已取消目标可以重新激活");
    }
    const goal = await prisma.goal.update({
      where: { id },
      data: {
        status: "OPEN",
        completedAt: null,
        cancelledReason: null,
        dueDate: input.dueDate ?? new Date(Date.now() + 7 * 24 * 60 * 60_000),
        ...(input.targetValue === undefined ? {} : { targetValue: input.targetValue }),
        ...revisionData(input.revisionReason),
        version: { increment: 1 },
      },
      include: goalInclude,
    });
    await audit(request, "GOAL_REACTIVATED", "GOAL", id, "SUCCESS", {
      revisionReason: goal.revisionReason ?? null,
    });
    return { goal };
  });

  app.post("/:id/cancel", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(goalCancelSchema, request.body);
    const existing = await prisma.goal.findFirst({ where: { id, userId: request.authUser!.id } });
    if (!existing) throw notFound();
    if (["CANCELLED", "ACHIEVED"].includes(existing.status)) {
      throw new AppError(409, "INVALID_GOAL_STATE", "当前目标不能取消");
    }
    const goal = await prisma.goal.update({
      where: { id },
      data: { status: "CANCELLED", cancelledReason: input.reason, version: { increment: 1 } },
      include: goalInclude,
    });
    await audit(request, "GOAL_CANCELLED", "GOAL", id, "SUCCESS");
    return { goal };
  });

  app.post("/:id/complete", async (request) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.goal.findFirst({ where: { id, userId: request.authUser!.id } });
    if (!existing) throw notFound();
    if (["CANCELLED", "ACHIEVED"].includes(existing.status)) {
      throw new AppError(409, "INVALID_GOAL_STATE", "当前目标不能确认完成");
    }
    // 与逾期扫描同一口径：已到期（即使扫描尚未落库）的目标必须先重新激活并修订目标，不能直接确认。
    if (isGoalOverdue({ status: existing.status, dueDate: existing.dueDate })) {
      throw new AppError(409, "GOAL_OVERDUE", "目标已逾期，请先重新激活并填写修订原因");
    }
    await prisma.$transaction(async (tx) => {
      await assertGoalCanComplete(tx, existing);
      await tx.goal.update({
        where: { id },
        data: { status: "ACHIEVED", completedAt: new Date(), version: { increment: 1 } },
      });
    });
    const goal = await prisma.goal.findUniqueOrThrow({ where: { id }, include: goalInclude });
    await audit(request, "GOAL_COMPLETED", "GOAL", id, "SUCCESS");
    return { goal };
  });

  app.get("/:id/progress", async (request) => {
    const { id } = request.params as { id: string };
    const goal = await prisma.goal.findFirst({ where: { id, userId: request.authUser!.id }, select: { id: true } });
    if (!goal) throw notFound();
    const data = await prisma.goalProgress.findMany({
      where: { goalId: id, userId: request.authUser!.id },
      orderBy: { recordedAt: "desc" },
      include: {
        session: { select: { id: true, title: true, startedAt: true } },
        evidenceMedia: { select: { id: true, originalName: true, status: true } },
      },
    });
    return { data };
  });

  app.post("/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(goalProgressCreateSchema, request.body);
    const [goal, session] = await Promise.all([
      prisma.goal.findFirst({ where: { id, userId: request.authUser!.id } }),
      prisma.practiceSession.findFirst({ where: { id: input.sessionId, userId: request.authUser!.id }, select: { id: true } }),
    ]);
    if (!goal) throw notFound();
    if (!session) throw new AppError(400, "VALIDATION_ERROR", "进度关联的练习不存在");
    if (["CANCELLED", "ACHIEVED"].includes(goal.status)) {
      throw new AppError(409, "INVALID_GOAL_STATE", "已取消或已完成目标不能新增进度");
    }
    // 与逾期扫描同一口径：已到期目标先重新激活并修订，再记录进度。
    if (isGoalOverdue({ status: goal.status, dueDate: goal.dueDate })) {
      throw new AppError(409, "GOAL_OVERDUE", "目标已逾期，请先重新激活并填写修订原因后再记录进度");
    }
    if (input.evidenceMediaId) {
      const evidence = await prisma.mediaAsset.findFirst({
        where: { id: input.evidenceMediaId, sessionId: input.sessionId, userId: request.authUser!.id, status: "READY" },
        select: { id: true },
      });
      if (!evidence) throw new AppError(400, "VALIDATION_ERROR", "证据音频必须来自关联练习且已就绪");
    }
    assertProgressEvidence(goal, input);
    const progress = await prisma.$transaction((tx) =>
      recordGoalProgress(tx, {
        userId: request.authUser!.id,
        goal,
        sessionId: input.sessionId,
        actualValue: input.actualValue,
        note: input.note,
        evidenceMediaId: input.evidenceMediaId,
        recordedAt: input.recordedAt,
      }).then(async (created) =>
        tx.goalProgress.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            session: { select: { id: true, title: true, startedAt: true } },
            evidenceMedia: { select: { id: true, originalName: true, status: true } },
          },
        }),
      ),
    );
    return reply.status(201).send({ progress });
  });
};

export default goalRoutes;
