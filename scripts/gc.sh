#!/usr/bin/env bash
# 手动触发维护任务：清理过期回收站、回收无引用的孤儿文件、删除过期导出包。
# 任务会交给 API 的 worker 执行（通常几十秒内完成，需 API 正在运行）。
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
require_db

STAMP="$(date +%Y%m%d%H%M%S)"
GC_ID="manual-gc-$STAMP"
PURGE_ID="manual-purge-$STAMP"

info "投递维护任务"
psql "$PG_URL" -q -c "
INSERT INTO jobs (id, type, payload, status, attempts, max_attempts, progress, created_at, updated_at)
VALUES
  ('$GC_ID', 'storage_gc', '{}'::jsonb, 'queued', 0, 1, 0, now(), now()),
  ('$PURGE_ID', 'trash_purge', '{}'::jsonb, 'queued', 0, 1, 0, now(), now());
"

info "等待执行结果（最多 120 秒）"
for _ in $(seq 1 40); do
  DONE_COUNT="$(pg_query "select count(*) from jobs where id in ('$GC_ID','$PURGE_ID') and status in ('done','failed')")"
  if [ "$DONE_COUNT" = "2" ]; then break; fi
  sleep 3
done

psql "$PG_URL" -c "select id, status, result, last_error from jobs where id in ('$GC_ID','$PURGE_ID');"

if [ "${DONE_COUNT:-0}" != "2" ]; then
  warn "任务在 120 秒内没有跑完。若 API 未运行，worker 不会执行——请先启动：pnpm start"
fi
