#!/usr/bin/env bash
# 项目自带的 PostgreSQL 集群管理：直接跑在本机，不改动系统服务、也不需要额外依赖。
# 数据放在 data/pgdata，socket 放在 data/pg-socket，日志写在 data/postgres.log。
#
# 用法：
#   bash scripts/pg.sh init     # 首次初始化（幂等）
#   bash scripts/pg.sh start    # 启动并确保数据库存在
#   bash scripts/pg.sh stop
#   bash scripts/pg.sh status
#   bash scripts/pg.sh psql     # 打开交互式 psql
#   bash scripts/pg.sh logs
set -euo pipefail

# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

PGDATA_DIR="${PGDATA_DIR:-$ROOT_DIR/data/pgdata}"
PG_SOCKET_DIR="${PG_SOCKET_DIR:-$ROOT_DIR/data/pg-socket}"
PG_LOG="${PG_LOG:-$ROOT_DIR/data/postgres.log}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-heirloom}"
PGDATABASE="${POSTGRES_DB:-heirloom}"
PGPASSWORD="${POSTGRES_PASSWORD:-}"

command -v initdb >/dev/null 2>&1 || fail "找不到 initdb，请先安装 PostgreSQL（macOS: brew install postgresql@16）"

pg_opts() {
  printf -- '-p %s -k %s' "$PGPORT" "$PG_SOCKET_DIR"
}

running() {
  pg_ctl -D "$PGDATA_DIR" status >/dev/null 2>&1
}

do_init() {
  if [ -f "$PGDATA_DIR/PG_VERSION" ]; then
    info "数据目录已存在，跳过初始化：$PGDATA_DIR"
    return
  fi
  [ -n "$PGPASSWORD" ] || fail "请在 .env 中设置 POSTGRES_PASSWORD（本地集群会用它作为 $PGUSER 的密码）"
  mkdir -p "$PGDATA_DIR" "$PG_SOCKET_DIR"

  local pwfile
  pwfile="$(mktemp)"
  printf '%s' "$PGPASSWORD" > "$pwfile"
  info "初始化本地集群：$PGDATA_DIR（用户 $PGUSER）"
  initdb -D "$PGDATA_DIR" -U "$PGUSER" --pwfile="$pwfile" \
    --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C >/dev/null
  rm -f "$pwfile"

  # 只监听本机，避免误暴露到局域网
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "unix_socket_directories = '$PG_SOCKET_DIR'"
    echo "port = $PGPORT"
  } >> "$PGDATA_DIR/postgresql.conf"
  info "初始化完成"
}

do_start() {
  [ -f "$PGDATA_DIR/PG_VERSION" ] || do_init
  if running; then
    info "集群已在运行（端口 $PGPORT）"
  else
    info "启动集群（端口 $PGPORT，数据目录 $PGDATA_DIR）"
    pg_ctl -D "$PGDATA_DIR" -l "$PG_LOG" -o "$(pg_opts)" -w start >/dev/null
  fi

  if ! psql "$PG_URL" -tAc 'select 1' >/dev/null 2>&1; then
    info "创建数据库 $PGDATABASE"
    PGPASSWORD="$PGPASSWORD" createdb -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$PGDATABASE"
  fi

  if psql "$PG_URL" -tAc 'select 1' >/dev/null 2>&1; then
    info "数据库可用：$PGDATABASE @127.0.0.1:$PGPORT"
  else
    fail "数据库启动后仍连不上，请查看日志：$PG_LOG"
  fi
}

do_stop() {
  if running; then
    pg_ctl -D "$PGDATA_DIR" -m fast -w stop >/dev/null
    info "集群已停止"
  else
    info "集群本来就没在运行"
  fi
}

case "${1:-}" in
  init) do_init ;;
  start) do_start ;;
  stop) do_stop ;;
  status)
    if running; then
      pg_ctl -D "$PGDATA_DIR" status
      psql "$PG_URL" -c 'select version();' | head -3
    else
      info "集群未运行"
    fi
    ;;
  psql) exec psql "$PG_URL" ;;
  logs) tail -n "${2:-50}" "$PG_LOG" ;;
  *)
    cat <<'USAGE'
用法：bash scripts/pg.sh <命令>
  init     首次初始化本地集群（幂等）
  start    启动集群并确保数据库存在
  stop     停止集群
  status   查看状态
  psql     打开交互式 psql
  logs     查看 PostgreSQL 日志（可跟行数）
USAGE
    ;;
esac
