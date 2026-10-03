import { describe, expect, it } from "vitest";
import {
  calculateSessionDuration,
  canTransitionSession,
  classifyProgressTrend,
  describeMissingReview,
  isGoalOverdue,
  isGoalProgressValid,
  validateAnnotationRange,
} from "../src/index.js";

describe("session state machine", () => {
  it("allows the required completion transition", () => {
    expect(canTransitionSession("IN_REVIEW", "COMPLETED")).toBe(true);
    expect(canTransitionSession("DRAFT", "COMPLETED")).toBe(false);
  });
});

describe("annotation range", () => {
  it("rejects ranges under 100ms and outside media", () => {
    expect(validateAnnotationRange(100, 150, 1000)).toMatchObject({ ok: false });
    expect(validateAnnotationRange(900, 1100, 1000)).toMatchObject({ ok: false });
    expect(validateAnnotationRange(100, 250, 1000)).toEqual({ ok: true });
  });
});

describe("review completion", () => {
  it("returns every missing item instead of a generic failure", () => {
    expect(
      describeMissingReview({
        readyMediaCount: 0,
        annotationCount: 0,
        noIssues: false,
        nextFocus: "",
        openGoalCount: 0,
        newGoalCount: 0,
        progressUpdateCount: 0,
      }),
    ).toHaveLength(4);
  });
});

describe("goal values", () => {
  it("suggests achieved only when actual reaches target", () => {
    expect(isGoalProgressValid(90, 88)).toBe(true);
    expect(isGoalProgressValid(87, 88)).toBe(false);
  });

  it("respects metric direction when deciding achievement", () => {
    expect(isGoalProgressValid(5, 10, "LOWER_BETTER")).toBe(true);
    expect(isGoalProgressValid(11, 10, "LOWER_BETTER")).toBe(false);
    expect(isGoalProgressValid(90, 88, "HIGHER_BETTER")).toBe(true);
    expect(isGoalProgressValid(87, 88, "HIGHER_BETTER")).toBe(false);
  });

  it("classifies trend against the metric direction", () => {
    expect(classifyProgressTrend({ current: 95, previous: 90, direction: "HIGHER_BETTER" })).toBe("UP");
    expect(classifyProgressTrend({ current: 85, previous: 90, direction: "HIGHER_BETTER" })).toBe("DOWN");
    expect(classifyProgressTrend({ current: 4, previous: 8, direction: "LOWER_BETTER" })).toBe("UP");
    expect(classifyProgressTrend({ current: 9, previous: 8, direction: "LOWER_BETTER" })).toBe("DOWN");
    expect(classifyProgressTrend({ current: 90, previous: 90, direction: "HIGHER_BETTER" })).toBe("FLAT");
    expect(classifyProgressTrend({ current: 90, direction: "HIGHER_BETTER" })).toBeNull();
  });

  it("treats values within tolerance as flat", () => {
    expect(classifyProgressTrend({ current: 90.2, previous: 90, direction: "HIGHER_BETTER", tolerance: 0.5 })).toBe("FLAT");
  });

  it("keeps overdue rule aligned with the daily scan", () => {
    const now = new Date("2026-10-02T08:00:00.000Z");
    expect(isGoalOverdue({ status: "IN_PROGRESS", dueDate: new Date("2026-10-01T00:00:00.000Z"), now })).toBe(true);
    expect(isGoalOverdue({ status: "OPEN", dueDate: new Date("2026-10-02T00:00:00.000Z"), now })).toBe(false);
    expect(isGoalOverdue({ status: "ACHIEVED", dueDate: new Date("2026-09-01T00:00:00.000Z"), now })).toBe(false);
    expect(isGoalOverdue({ status: "CANCELLED", dueDate: new Date("2026-09-01T00:00:00.000Z"), now })).toBe(false);
  });

  it("sums only valid media durations", () => {
    expect(calculateSessionDuration([1000, null, 2500, -1])).toBe(3500);
  });
});
