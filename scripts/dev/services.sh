#!/usr/bin/env bash
# Local dev services for VOICES: Postgres 16 on 14001, Redis on 14002. Idempotent.
# Usage: scripts/dev/services.sh up|down|status   (down stops only what this script started)
# Data lives under $VOICES_SERVICES_DIR (default /home/user/wt/v-services). Dev only: trust auth, no real secrets.
set -euo pipefail

DIR="${VOICES_SERVICES_DIR:-/home/user/wt/v-services}"
PG_PORT="${VOICES_PG_PORT:-14001}"
REDIS_PORT="${VOICES_REDIS_PORT:-14002}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
PGDATA="$DIR/pg"
REDIS_PID="$DIR/redis.pid"

as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
pg_up() { "${PGBIN}/pg_isready" -q -h 127.0.0.1 -p "$PG_PORT"; }
redis_up() { (exec 3<>"/dev/tcp/127.0.0.1/$REDIS_PORT") 2>/dev/null; }

up() {
  mkdir -p "$DIR"
  if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; fi
  if pg_up; then
    echo "postgres: already running on $PG_PORT (reused)"
  else
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 >"$DIR/initdb.log" 2>&1
    fi
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=200 -c fsync=off" \
      -l "$DIR/pg.log" -w start >/dev/null
    echo "postgres: started on $PG_PORT"
  fi
  if redis_up; then
    echo "redis: already running on $REDIS_PORT (reused)"
  else
    redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --dir "$DIR" --daemonize yes --save "" \
      --pidfile "$REDIS_PID" --logfile "$DIR/redis.log" >/dev/null
    echo "redis: started on $REDIS_PORT"
  fi
  status
}

down() {
  if [ -f "$PGDATA/postmaster.pid" ] && as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null; echo "postgres: stopped"
  else echo "postgres: not started by this script (left alone)"; fi
  if [ -f "$REDIS_PID" ] && kill -0 "$(cat "$REDIS_PID")" 2>/dev/null; then
    kill "$(cat "$REDIS_PID")"; echo "redis: stopped"
  else echo "redis: not started by this script (left alone)"; fi
}

status() {
  if pg_up; then echo "postgres: up on $PG_PORT"; else echo "postgres: down"; fi
  if redis_up; then echo "redis: up on $REDIS_PORT"; else echo "redis: down"; fi
  pg_up && redis_up
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *) echo "usage: $0 up|down|status" >&2; exit 2 ;;
esac
