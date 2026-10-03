-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('UP', 'DOWN');

-- AlterTable
ALTER TABLE "goals" ADD COLUMN "metric_direction" "MetricDirection" NOT NULL DEFAULT 'UP';

ALTER TABLE "goal_progress" ADD COLUMN "revision_reason" VARCHAR(1000);
