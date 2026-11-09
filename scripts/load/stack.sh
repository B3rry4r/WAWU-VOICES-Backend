#!/usr/bin/env bash
# LCH-09: the production builds behind nginx, the way the droplet runs them, on this machine.
#   scripts/load/stack.sh build     production builds of the API (nest build) and the web (next build), checks the web bundle for live hosts
#   scripts/load/stack.sh up        Postgres + Redis (own instances), migrate, seed, stand-ins, API, web, nginx; all app processes pinned to APP_CPUS
#   scripts/load/stack.sh down      stops only what this script started (PIDs in $RUN/pids)
#   scripts/load/stack.sh status
#   scripts/load/stack.sh seed      (re)seed the database only
# Nothing here ever reaches WAWU ID, Flutterwave, Gemini, Spaces or any real host.
set -euo pipefail
# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

mkdir -p "$RUN/logs" "$RUN/pids" "$RUN/nginx-tmp" "$RUN/cache"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
PGDATA="$RUN/pg"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
DB_URL="postgresql://postgres@127.0.0.1:$P_PG/$DB_NAME?schema=public"
REDIS_URL="redis://127.0.0.1:$P_REDIS/$REDIS_DB"
pin() { taskset -c "$APP_CPUS" "$@"; }
pidf() { echo "$RUN/pids/$1.pid"; }
alive() { [ -f "$(pidf "$1")" ] && kill -0 "$(cat "$(pidf "$1")")" 2>/dev/null; }

wait_http() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  echo "not answering: $1" >&2; return 1
}

api_env() {
  cat <<ENV
NODE_ENV=production
PORT=$P_API
DATABASE_URL=$DB_URL
DATABASE_POOL_MAX=${DATABASE_POOL_MAX:-20}
REDIS_URL=$REDIS_URL
WAWU_ID_JWKS_URL=http://127.0.0.1:$P_ID/.well-known/jwks.json
CORS_ORIGIN=http://127.0.0.1:$P_NGINX,http://localhost:$P_NGINX
VOICES_PHONE_PEPPER=$PHONE_PEPPER
SPACES_ENDPOINT=http://127.0.0.1:$P_SPACES
SPACES_REGION=load
SPACES_BUCKET=voices-load
SPACES_KEY=load
SPACES_SECRET=load
APP_BASE_URL=http://127.0.0.1:$P_NGINX
PUBLIC_WEB_BASE=http://127.0.0.1:$P_NGINX
THROTTLE_LIMIT=${THROTTLE_LIMIT:-600}
ENV
}

build() {
  echo "== api build"
  (cd "$API_DIR" && npm run build > "$RUN/logs/build-api.log" 2>&1; echo "API BUILD EXIT $?")
  echo "== web build (every NEXT_PUBLIC_* base points at the stand-ins)"
  (cd "$WEB_DIR" && NEXT_PUBLIC_API_BASE_URL=/api/v1 NEXT_PUBLIC_WAWU_ID_BASE="http://127.0.0.1:$P_ID" npx next build > "$RUN/logs/build-web.log" 2>&1; echo "WEB BUILD EXIT $?")
  # The droplet does this in deploy.sh: gzip the built files once so nginx can send them with gzip_static.
  (cd "$WEB_DIR" && find .next/static -type f \( -name '*.js' -o -name '*.css' \) -exec gzip -kf9 {} +)
  # A live host would be a URL the browser could call. The bare words "usevoices.com" in a share label are text, not a call.
  if grep -rEoh "https?://[A-Za-z0-9.-]*(wawuafrica|usevoices)\.com[^\"' )]*" "$WEB_DIR/.next/static" "$WEB_DIR/.next/server" 2>/dev/null | sort | uniq -c | grep .; then
    echo "BUNDLE CHECK EXIT 1 (a live host is in the build)"
  else echo "BUNDLE CHECK EXIT 0 (no wawuafrica.com or usevoices.com URL in the built files; the label text usevoices.com is display only)"; fi
}

pg_up() {
  if "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$P_PG"; then echo "postgres: already up on $P_PG"; return; fi
  mkdir -p "$PGDATA" "$RUN/pgsock"
  [ "$(id -u)" = 0 ] && chown postgres "$PGDATA" "$RUN/pgsock" && chmod 755 "$RUN" "$RUN/.." 2>/dev/null || true
  if [ ! -f "$PGDATA/PG_VERSION" ]; then as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 > "$RUN/logs/initdb.log" 2>&1; fi
  # The droplet's own defaults (max_connections 100, fsync on); only the port and socket folder are ours.
  local asu=(); [ "$(id -u)" = 0 ] && asu=(runuser -u postgres --)
  pin "${asu[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $P_PG -k $RUN/pgsock -c listen_addresses=127.0.0.1" -l "$PGDATA/pg.log" -w start > /dev/null
  echo "postgres: started on $P_PG"
}
pg_down() { if "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$P_PG" && [ -f "$RUN/pg-started" ]; then as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop > /dev/null; rm -f "$RUN/pg-started"; fi; }

redis_up() {
  if (exec 3<>"/dev/tcp/127.0.0.1/$P_REDIS") 2>/dev/null; then echo "redis: already up on $P_REDIS"; return; fi
  pin redis-server --port "$P_REDIS" --bind 127.0.0.1 --dir "$RUN" --daemonize yes --pidfile "$(pidf redis)" --logfile "$RUN/logs/redis.log" > /dev/null
  echo "redis: started on $P_REDIS"
}

migrate_and_seed() {
  "$PGBIN/psql" -h 127.0.0.1 -p "$P_PG" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
    || "$PGBIN/createdb" -h 127.0.0.1 -p "$P_PG" -U postgres "$DB_NAME"
  (cd "$API_DIR" && DATABASE_URL="$DB_URL" npx prisma migrate deploy > "$RUN/logs/migrate.log" 2>&1; echo "MIGRATE EXIT $?")
  seed
}

seed() {
  DATABASE_URL="$DB_URL" API_DIR="$API_DIR" node "$HERE_LOAD/seed.mjs" > "$RUN/logs/seed.log" 2>&1; echo "SEED EXIT $?"; tail -3 "$RUN/logs/seed.log"
}

start() { # name, cpus ("" = none), logfile-name, cmd...
  local name=$1 cpus=$2; shift 2
  if alive "$name"; then echo "$name: already up"; return; fi
  if [ -n "$cpus" ]; then nohup taskset -c "$cpus" "$@" > "$RUN/logs/$name.log" 2>&1 & else nohup "$@" > "$RUN/logs/$name.log" 2>&1 & fi
  echo $! > "$(pidf "$name")"
}

render_nginx() {
  sed -e "s|__RUN__|$RUN|g" "$HERE_LOAD/nginx-main.conf.tpl" > "$RUN/nginx.conf"
  # The repo's own site file, with only the addresses and folders moved to our ports.
  sed -e "s/__DOMAIN__/localhost/g" \
      -e "s|__WEB_ROOT__|$WEB_DIR|g" \
      -e "s|listen 80;|listen $P_NGINX;|" \
      -e "/listen \[::\]:80;/d" \
      -e "s|127.0.0.1:4000|127.0.0.1:$P_API|" \
      -e "s|127.0.0.1:3000|127.0.0.1:$P_WEB|" \
      -e "s|/var/cache/nginx/voices|$RUN/cache|" \
      -e "s|root /var/www/voices;|root $RUN/www;|" \
      "$REPO_ROOT/infra/nginx/voices.conf" > "$RUN/voices.site.conf"
  mkdir -p "$RUN/www"; cp "$REPO_ROOT/infra/nginx/busy.html" "$RUN/www/busy.html"
  # An extra override file may be dropped in to test one change (a worker_connections value, say): LOAD_NGINX_SED="s/a/b/" ...
  if [ -n "${LOAD_NGINX_SED:-}" ]; then sed -i -e "$LOAD_NGINX_SED" "$RUN/voices.site.conf" "$RUN/nginx.conf"; fi
  nginx -t -c "$RUN/nginx.conf" -e "$RUN/logs/nginx-error.log" > "$RUN/logs/nginx-test.log" 2>&1 || { cat "$RUN/logs/nginx-test.log"; return 1; }
}

up() {
  pg_up; touch "$RUN/pg-started"; redis_up
  migrate_and_seed
  start standin "$GEN_CPUS" node "$HERE_LOAD/standin.mjs" --id-port "$P_ID" --spaces-port "$P_SPACES" --api-dir "$API_DIR"
  wait_http "http://127.0.0.1:$P_ID/.well-known/jwks.json" 20
  # The API and the web server as the systemd units run them: node dist/main.js and next start.
  set -a; eval "$(api_env)"; set +a
  (cd "$API_DIR" && start api "$APP_CPUS" node --max-old-space-size="${API_HEAP_MB:-1536}" dist/main.js)
  wait_http "http://127.0.0.1:$P_API/api/health" 60
  # shellcheck disable=SC2046
  (cd "$WEB_DIR" && NODE_ENV=production PORT=$P_WEB HOSTNAME=127.0.0.1 VOICES_API_BASE="http://127.0.0.1:$P_API/api/v1" NEXT_PUBLIC_API_BASE_URL=/api/v1 \
     start web "$APP_CPUS" node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$P_WEB")
  wait_http "http://127.0.0.1:$P_WEB/go" 60
  render_nginx
  if ! alive nginx; then taskset -c "$APP_CPUS" nginx -c "$RUN/nginx.conf" -e "$RUN/logs/nginx-error.log"; sleep 1; cp "$RUN/nginx.pid" "$(pidf nginx)"; fi
  wait_http "http://127.0.0.1:$P_NGINX/api/health" 20
  status
}

down() {
  if alive nginx; then nginx -c "$RUN/nginx.conf" -e "$RUN/logs/nginx-error.log" -s quit || true; rm -f "$(pidf nginx)"; fi
  for n in web api standin; do
    if alive "$n"; then kill "$(cat "$(pidf "$n")")" 2>/dev/null || true; rm -f "$(pidf "$n")"; fi
  done
  if [ -f "$(pidf redis)" ] && kill -0 "$(cat "$(pidf redis)")" 2>/dev/null; then kill "$(cat "$(pidf redis)")" || true; fi
  pg_down
  echo "stack: stopped (only what this script started)"
}

status() {
  for n in standin api web nginx redis; do
    if [ -f "$(pidf $n)" ] && kill -0 "$(cat "$(pidf $n)")" 2>/dev/null; then echo "$n: up (pid $(cat "$(pidf $n)"))"; else echo "$n: down"; fi
  done
  "$PGBIN/pg_isready" -h 127.0.0.1 -p "$P_PG" || true
}

case "${1:-}" in
  build) build ;;
  up) up ;;
  down) down ;;
  status) status ;;
  seed) seed ;;
  *) echo "usage: stack.sh build|up|down|status|seed" >&2; exit 2 ;;
esac
