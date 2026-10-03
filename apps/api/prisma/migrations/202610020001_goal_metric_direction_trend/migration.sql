-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('HIGHER_BETTER', 'LOWER_BETTER');

-- CreateEnum
CREATE TYPE "ProgressTrend" AS ENUM ('UP', 'DOWN', 'FLAT');

-- AlterTable
ALTER TABLE "goals"
  ADD COLUMN "metric_direction" "MetricDirection" NOT NULL DEFAULT 'HIGHER_BETTER',
  ADD COLUMN "revision_reason" TEXT;

-- AlterTable
ALTER TABLE "goal_progress"
  ADD COLUMN "trend" "ProgressTrend";

-- Backfill trend for historical progress rows using the goal's metric direction.
-- UP: movement toward the target direction; DOWN: away from it; FLAT: unchanged.
WITH ordered AS (
  SELECT
    gp.id,
    g."metric_direction",
    gp."actual_value",
    LAG(gp."actual_value") OVER (PARTITION BY gp."goal_id" ORDER BY gp."recorded_at" ASC, gp."created_at" ASC) AS previous_value
  FROM "goal_progress" gp
  JOIN "goals" g ON g.id = gp."goal_id"
)
UPDATE "goal_progress" gp
SET "trend" = CASE
  WHEN ordered."actual_value" = ordered.previous_value THEN 'FLAT'
  WHEN ordered."metric_direction" = 'HIGHER_BETTER' AND ordered."actual_value" > ordered.previous_value THEN 'UP'
  WHEN ordered."metric_direction" = 'LOWER_BETTER' AND ordered."actual_value" < ordered.previous_value THEN 'UP'
  ELSE 'DOWN'
END::"ProgressTrend"
FROM ordered
WHERE gp.id = ordered.id AND ordered.previous_value IS NOT NULL;
