import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { createMock, updateMock, findFirstMock, findManyMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    goalProgress: { create: createMock, findFirst: findFirstMock, findMany: findManyMock },
    goal: { update: updateMock },
  },
}));

import { AppError } from "../src/lib/errors.js";
import {
  assertGoalCanComplete,
  assertProgressEvidence,
  recordGoalProgress,
} from "../src/lib/goal-service.js";

const tx = {
  goalProgress: { create: createMock, findFirst: findFirstMock, findMany: findManyMock },
  goal: { update: updateMock },
} as unknown as Prisma.TransactionClient;

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function goalLike(
  status: string,
  targetValue: number,
  metricDirection: "HIGHER_BETTER" | "LOWER_BETTER" = "HIGHER_BETTER",
) {
  return { id: "g1", status, targetValue: decimal(targetValue), metricDirection };
}

describe("recordGoalProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data }));
    updateMock.mockResolvedValue({});
  });

  it("creates a new row every time and never overwrites history", async () => {
    findFirstMock.mockResolvedValueOnce({ actualValue: decimal(80) });
    await recordGoalProgress(tx, {
      userId: "u1", goal: goalLike("IN_PROGRESS", 88), sessionId: "s1", actualValue: 85,
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]![0].data.id).toBeUndefined();
  });

  it("classifies trend UP for higher-is-better improvement and flips OPEN to IN_PROGRESS", async () => {
    findFirstMock.mockResolvedValueOnce({ actualValue: decimal(80) });
    await recordGoalProgress(tx, {
      userId: "u1", goal: goalLike("OPEN", 88), sessionId: "s1", actualValue: 85,
    });
    expect(createMock.mock.calls[0]![0].data.trend).toBe("UP");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "IN_PROGRESS" }),
    }));
  });

  it("classifies trend UP when a lower-is-better metric decreases", async () => {
    findFirstMock.mockResolvedValueOnce({ actualValue: decimal(6) });
    await recordGoalProgress(tx, {
      userId: "u1", goal: goalLike("IN_PROGRESS", 5, "LOWER_BETTER"), sessionId: "s1", actualValue: 10,
    });
    expect(createMock.mock.calls[0]![0].data.trend).toBe("DOWN");
    findFirstMock.mockResolvedValueOnce({ actualValue: decimal(8) });
    await recordGoalProgress(tx, {
      userId: "u1", goal: goalLike("IN_PROGRESS", 5, "LOWER_BETTER"), sessionId: "s1", actualValue: 4,
    });
    expect(createMock.mock.calls[1]![0].data.trend).toBe("UP");
  });

  it("records null trend on the first progress entry", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await recordGoalProgress(tx, {
      userId: "u1", goal: goalLike("OPEN", 88), sessionId: "s1", actualValue: 70,
    });
    expect(createMock.mock.calls[0]![0].data.trend).toBeNull();
  });

  it("auto-achieves an open goal when actual reaches target by direction", async () => {
    findFirstMock.mockResolvedValueOnce({ actualValue: decimal(80) });
    await recordGoalProgress(tx, {
      userId: "u1", goal: goalLike("IN_PROGRESS", 88), sessionId: "s1", actualValue: 90,
    });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ACHIEVED", completedAt: expect.any(Date) }),
    }));
  });

  it("auto-achieves a lower-is-better goal when actual drops to target", async () => {
    findFirstMock.mockResolvedValueOnce({ actualValue: decimal(10) });
    await recordGoalProgress(tx, {
      userId: "u1", goal: goalLike("IN_PROGRESS", 5, "LOWER_BETTER"), sessionId: "s1", actualValue: 5,
    });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ACHIEVED" }),
    }));
  });

  it("does not change state when another reaching record is added to an achieved goal", async () => {
    findFirstMock.mockResolvedValueOnce({ actualValue: decimal(90) });
    await recordGoalProgress(tx, {
      userId: "u1", goal: goalLike("ACHIEVED", 88), sessionId: "s1", actualValue: 92,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("assertGoalCanComplete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects manual confirmation without a reaching progress record", async () => {
    findManyMock.mockResolvedValueOnce([{ actualValue: decimal(80) }]);
    await expect(assertGoalCanComplete(tx, goalLike("IN_PROGRESS", 88))).rejects.toMatchObject({
      statusCode: 409,
      code: "GOAL_NOT_REACHED",
    } satisfies Partial<AppError>);
  });

  it("allows confirmation when a record reaches the target by direction", async () => {
    findManyMock.mockResolvedValueOnce([
      { actualValue: decimal(4) },
      { actualValue: decimal(9) },
    ]);
    await expect(assertGoalCanComplete(tx, goalLike("IN_PROGRESS", 5, "LOWER_BETTER"))).resolves.toBeUndefined();
  });

  it("rejects cancels and repeated confirmation of achieved goals", async () => {
    await expect(assertGoalCanComplete(tx, goalLike("CANCELLED", 88))).rejects.toMatchObject({ code: "INVALID_GOAL_STATE" });
    await expect(assertGoalCanComplete(tx, goalLike("ACHIEVED", 88))).rejects.toMatchObject({ code: "INVALID_GOAL_STATE" });
  });
});

describe("assertProgressEvidence", () => {
  it("requires audio evidence when the goal demands it", () => {
    expect(() => assertProgressEvidence({ evidenceRequirement: "AUDIO" }, {})).toThrow(AppError);
    expect(() => assertProgressEvidence({ evidenceRequirement: "AUDIO" }, { evidenceMediaId: "m1" })).not.toThrow();
  });

  it("requires a self-review note when configured", () => {
    expect(() => assertProgressEvidence({ evidenceRequirement: "SELF_REVIEW" }, { note: "  " })).toThrow(AppError);
    expect(() => assertProgressEvidence({ evidenceRequirement: "SELF_REVIEW" }, { note: "已稳定" })).not.toThrow();
  });

  it("accepts anything for NONE", () => {
    expect(() => assertProgressEvidence({}, {})).not.toThrow();
  });
});
