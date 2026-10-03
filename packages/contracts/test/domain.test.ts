import { describe, expect, it } from "vitest";
import {
  calculateSessionDuration,
  canTransitionSession,
  classifyProgressTrend,
  defaultMetricDirectionForType,
  describeMissingReview,
  isGoalProgressValid,
  isTargetReached,
  missingGoalEvidence,
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

  it("defaults count-like metrics downward and the rest upward", () => {
    expect(defaultMetricDirectionForType("COUNT")).toBe("DOWN");
    expect(defaultMetricDirectionForType("SPEED")).toBe("UP");
    expect(defaultMetricDirectionForType("ACCURACY")).toBe("UP");
  });

  it("reaches the target according to metric direction", () => {
    expect(isTargetReached({ actualValue: 2, targetValue: 5, metricDirection: "DOWN" })).toBe(true);
    expect(isTargetReached({ actualValue: 6, targetValue: 5, metricDirection: "DOWN" })).toBe(false);
    expect(isTargetReached({ actualValue: 92, targetValue: 90, metricDirection: "UP" })).toBe(true);
    expect(isTargetReached({ actualValue: 89, targetValue: 90, metricDirection: "UP" })).toBe(false);
  });

  it("classifies trends in the goal's direction", () => {
    expect(classifyProgressTrend({ currentValue: 95, previousValue: 90, metricDirection: "UP" })).toBe("IMPROVING");
    expect(classifyProgressTrend({ currentValue: 3, previousValue: 5, metricDirection: "DOWN" })).toBe("IMPROVING");
    expect(classifyProgressTrend({ currentValue: 6, previousValue: 5, metricDirection: "DOWN" })).toBe("REGRESSING");
    expect(classifyProgressTrend({ currentValue: 5, previousValue: 5, metricDirection: "DOWN" })).toBe("FLAT");
    expect(classifyProgressTrend({ currentValue: 90, metricDirection: "UP" })).toBe("FLAT");
  });

  it("requires audio and self-review evidence by requirement level", () => {
    expect(missingGoalEvidence({ evidenceRequirement: "NONE" })).toHaveLength(0);
    expect(missingGoalEvidence({ evidenceRequirement: "AUDIO" })).toHaveLength(1);
    expect(missingGoalEvidence({ evidenceRequirement: "AUDIO", evidenceMediaId: "m1" })).toHaveLength(0);
    expect(missingGoalEvidence({ evidenceRequirement: "SELF_REVIEW" })).toHaveLength(1);
    expect(missingGoalEvidence({ evidenceRequirement: "SELF_REVIEW", revisionReason: "目标已在现场稳定达成" })).toHaveLength(0);
    expect(missingGoalEvidence({ evidenceRequirement: "AUDIO_AND_SELF_REVIEW", evidenceMediaId: "m1", note: "连续三遍无误" })).toHaveLength(0);
    expect(missingGoalEvidence({ evidenceRequirement: "AUDIO_AND_SELF_REVIEW", evidenceMediaId: "m1" })).toHaveLength(1);
  });

  it("sums only valid media durations", () => {
    expect(calculateSessionDuration([1000, null, 2500, -1])).toBe(3500);
  });
});
