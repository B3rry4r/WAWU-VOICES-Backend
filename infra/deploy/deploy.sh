#!/usr/bin/env bash
# VOICES deploy, run on the droplet as the voices user after CI has rsynced the source into /srv/voices/{api,web}.
#   bash /srv/voices/deploy/deploy.sh [api|web|all]          build a new release and switch to it
#   bash /srv/voices/deploy/deploy.sh rollback api|web       point back at the previous release and restart
#
# V-DEPLOY-SAFE. A deploy must never break a page that is open or being opened.
#   /srv/voices/api, /srv/voices/web    the source CI rsyncs (never built in, never run from)
#   /srv/voices/releases/<app>/<id>     one folder per release: its own copy of the source, node_modules and build
#   /srv/voices/<app>-current           symlink to the release that is live (the systemd units start from it)
#   /srv/voices/<app>-previous          symlink to the release before it (what `rollback` goes back to)
#   /srv/voices/web-static              every web release's .next/static files, added to and never replaced:
#                                       nginx serves /_next/static from here, so a page loaded from the old
#                                       release can still fetch its chunks after the switch
# A build that fails changes nothing live: the half-built folder is deleted and the symlinks stay put.
# Web runs as two Next servers (voices-web@3001 and @3002), restarted one at a time, with nginx sending each
# request to whichever one is up, so the restart is not seen. The API is one process (it runs the schedulers,
# so two would run each job twice): it has a gap of a few seconds at the restart, and only then.
#
# Until infra/deploy/layout-once.sh has been run on the droplet (it writes $ROOT/.layout-v2), this script does the
# old in-place deploy, so merging this file before the owner runs that paste breaks nothing.
#
# NODE_ENV=production is set by the env files, which makes a bare npm ci skip devDependencies
# (nest, prisma, next, typescript). The build needs them, so install with --include=dev.
#
# VOICES_* variables below exist so the whole script can run against a scratch folder on a test machine.
set -euo pipefail
WHAT="${1:-all}"
ROOT="${VOICES_ROOT:-/srv/voices}"
ENV_DIR="${VOICES_ENV_DIR:-/etc/voices}"
KEEP="${VOICES_KEEP:-3}"                          # releases kept per app
WEB_PORTS="${VOICES_WEB_PORTS:-3001 3002}"        # the two Next servers, restarted one at a time
API_PORT="${VOICES_API_PORT:-4000}"
STATIC_MIN_AGE_DAYS="${VOICES_STATIC_MIN_AGE_DAYS:-7}"  # a static file is also kept this long, whatever the release count
# shellcheck disable=SC2206
RESTART=(${VOICES_RESTART:-sudo /usr/bin/systemctl restart})

say() { echo "== $*"; }
# The build shares a small machine with the live site: run it at low priority so the servers keep their turn.
lower_priority() { renice -n 15 -p "$BASHPID" >/dev/null 2>&1 || true; ionice -c3 -p "$BASHPID" >/dev/null 2>&1 || true; }
die() { echo "deploy: $*" >&2; exit 1; }

# ---------------------------------------------------------------- the old in-place deploy (until layout-once.sh has run)
legacy_api() {
  cd "$ROOT/api"
  set -a
  # shellcheck disable=SC1091
  . "$ENV_DIR/api.env"
  set +a
  npm ci --include=dev --no-audit --no-fund
  npx prisma generate
  npx prisma migrate deploy
  npm run build
  "${RESTART[@]}" voices-api
}
legacy_web() {
  cd "$ROOT/web"
  set -a
  # shellcheck disable=SC1091
  . "$ENV_DIR/web.env"
  set +a
  npm ci --include=dev --no-audit --no-fund
  npm run build
  find .next/static -type f \( -name '*.js' -o -name '*.css' \) -exec gzip -kf9 {} +
  "${RESTART[@]}" voices-web
}

# ---------------------------------------------------------------- helpers
link_target() { [ -L "$1" ] && readlink -f "$1" || true; }          # empty when the link is missing
point() { ln -sfn "$2" "$1.tmp.$$" && mv -Tf "$1.tmp.$$" "$1"; }    # atomic: a reader sees the old or the new, never none

# wait_http URL SECONDS REGEX: the status code of GET URL must match REGEX within SECONDS
wait_http() {
  local url=$1 secs=$2 re=$3 code="000" i
  for ((i = 0; i < secs * 5; i++)); do
    code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$url" 2>/dev/null || true)
    [[ "$code" =~ $re ]] && return 0
    sleep 0.2
  done
  echo "deploy: $url answered $code, wanted $re" >&2
  return 1
}

# new_release APP: sets REL (folder) and copies the source CI synced into it.
new_release() {
  local app=$1 d
  mkdir -p "$ROOT/releases/$app"
  shopt -s nullglob
  # Leftovers of a build that died (no .ok file) are never kept.
  for d in "$ROOT/releases/$app"/*/; do [ -e "${d}.ok" ] || rm -rf "$d"; done
  shopt -u nullglob
  REL="$ROOT/releases/$app/${VOICES_RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
  [ ! -e "$REL" ] || die "release $REL already exists"
  [ -d "$ROOT/$app" ] || die "no source in $ROOT/$app (CI rsyncs it there first)"
  mkdir -p "$REL"
  # The same things CI's rsync keeps out of the source folder, plus .env files: the env lives in /etc/voices.
  tar -C "$ROOT/$app" --exclude='./node_modules' --exclude='./.next' --exclude='./dist' --exclude=generated \
      --exclude='./.env' --exclude='./.env.*' -cf - . | tar -C "$REL" -xf -
}

# keep_last APP: the newest $KEEP releases stay, and so do the two the links point at (live and rollback).
keep_last() {
  local app=$1 dir="$ROOT/releases/$1" cur prev n=0 r
  cur=$(link_target "$ROOT/$app-current"); prev=$(link_target "$ROOT/$app-previous")
  KEPT=()
  while IFS= read -r r; do
    [ -e "$dir/$r/.ok" ] || continue
    n=$((n + 1))
    if [ "$n" -le "$KEEP" ] || [ "$dir/$r" = "$cur" ] || [ "$dir/$r" = "$prev" ]; then KEPT+=("$dir/$r"); else
      say "removing old $app release $r"; rm -rf "${dir:?}/$r"
    fi
  done < <(ls -1 "$dir" | sort -r)
}

# prune_static: web-static keeps what any kept release has, and anything newer than STATIC_MIN_AGE_DAYS.
prune_static() {
  local keepf havef r
  keepf=$(mktemp); havef=$(mktemp)
  for r in "${KEPT[@]}"; do (cd "$r/.next/static" && find . -type f) >> "$keepf"; done
  if [ -s "$keepf" ]; then
    sort -u -o "$keepf" "$keepf"
    (cd "$ROOT/web-static" && find . -type f -mtime "+$STATIC_MIN_AGE_DAYS" | sort) > "$havef"
    comm -13 "$keepf" "$havef" | while IFS= read -r f; do rm -f "$ROOT/web-static/$f"; done
    find "$ROOT/web-static" -mindepth 1 -type d -empty -delete
  fi
  rm -f "$keepf" "$havef"
}

# publish_static REL: add (never replace, never delete) this release's static files.
publish_static() {
  mkdir -p "$ROOT/web-static"
  tar -C "$1/.next/static" -cf - . | tar -C "$ROOT/web-static" -xf - --skip-old-files
}

# switch APP REL: previous <- current, current <- REL. Sets OLD_CUR / OLD_PREV so a failed check can undo it.
switch() {
  local app=$1 rel=$2
  OLD_CUR=$(link_target "$ROOT/$app-current"); OLD_PREV=$(link_target "$ROOT/$app-previous")
  if [ -n "$OLD_CUR" ] && [ "$OLD_CUR" != "$rel" ]; then point "$ROOT/$app-previous" "$OLD_CUR"; fi
  point "$ROOT/$app-current" "$rel"
}
undo_switch() {
  local app=$1
  if [ -n "$OLD_CUR" ]; then point "$ROOT/$app-current" "$OLD_CUR"; fi
  if [ -n "$OLD_PREV" ]; then point "$ROOT/$app-previous" "$OLD_PREV"; fi
}

# roll_web: restart the Next servers one at a time. The other one keeps answering, and nginx retries a refused connection on it.
roll_web() {
  local port done_ports=()
  for port in $WEB_PORTS; do
    "${RESTART[@]}" "voices-web@$port"
    done_ports+=("$port")
    if ! wait_http "http://127.0.0.1:$port/" 90 '^[23]'; then
      echo "deploy: the new web release does not answer on $port; going back to the old one" >&2
      undo_switch web
      for port in "${done_ports[@]}"; do "${RESTART[@]}" "voices-web@$port"; done
      return 1
    fi
  done
}
roll_api() {
  "${RESTART[@]}" voices-api
  if ! wait_http "http://127.0.0.1:$API_PORT/api/health" 90 '^200$'; then
    echo "deploy: the new API release does not answer; going back to the old one" >&2
    undo_switch api
    "${RESTART[@]}" voices-api
    return 1
  fi
}

# ---------------------------------------------------------------- the two deploys
deploy_api() {
  new_release api
  say "api release $REL"
  set +e
  (
    set -e
    lower_priority
    cd "$REL"
    set -a
    # shellcheck disable=SC1091
    . "$ENV_DIR/api.env"
    set +a
    npm ci --include=dev --no-audit --no-fund
    npx prisma generate
    # Migrations run before the switch, as before; they are additive, so the API still running is not hurt by them.
    npx prisma migrate deploy
    npm run build
  )
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then rm -rf "$REL"; die "the API build failed (exit $rc); nothing changed live"; fi
  touch "$REL/.ok"
  switch api "$REL"
  roll_api || { rm -rf "$REL"; die "the new API release failed; the old one is back"; }
  keep_last api
}

deploy_web() {
  new_release web
  say "web release $REL"
  set +e
  (
    set -e
    lower_priority
    cd "$REL"
    set -a
    # shellcheck disable=SC1091
    . "$ENV_DIR/web.env"
    set +a
    npm ci --include=dev --no-audit --no-fund
    npm run build
    # LCH-09: nginx serves the built files itself and sends these compressed copies (gzip_static), so a burst of first visits
    # does not spend the CPU compressing the same files over and over.
    find .next/static -type f \( -name '*.js' -o -name '*.css' \) -exec gzip -kf9 {} +
  )
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then rm -rf "$REL"; die "the web build failed (exit $rc); nothing changed live"; fi
  touch "$REL/.ok"
  # Static files first, so the new pages find their chunks the moment a server starts on the new release.
  publish_static "$REL"
  switch web "$REL"
  roll_web || { rm -rf "$REL"; die "the new web release failed; the old one is back"; }
  keep_last web
  prune_static
}

rollback() {
  local app=$1 prev cur
  case "$app" in api|web) ;; *) die "usage: deploy.sh rollback api|web" ;; esac
  prev=$(link_target "$ROOT/$app-previous"); cur=$(link_target "$ROOT/$app-current")
  [ -n "$prev" ] && [ -d "$prev" ] || die "no previous $app release to go back to"
  say "$app: $(basename "$cur") -> $(basename "$prev")"
  [ "$app" = web ] && publish_static "$prev"
  # If the release we go back to will not start, undo_switch puts the links back where they were.
  OLD_CUR=$cur; OLD_PREV=$prev
  point "$ROOT/$app-previous" "$cur"
  point "$ROOT/$app-current" "$prev"
  if [ "$app" = web ]; then roll_web; else roll_api; fi
}

# ---------------------------------------------------------------- main
mkdir -p "$ROOT/deploy"
exec 9> "$ROOT/deploy/.lock"
flock -n 9 || die "another deploy is running"

if [ ! -e "$ROOT/.layout-v2" ]; then
  echo "deploy: $ROOT/.layout-v2 is missing, so layout-once.sh has not run on this droplet yet. Doing the old in-place deploy (pages can break during the build)." >&2
  case "$WHAT" in
    api) legacy_api ;;
    web) legacy_web ;;
    all) legacy_api; legacy_web ;;
    *) die "usage: deploy.sh [api|web|all] | rollback api|web" ;;
  esac
  exit 0
fi

case "$WHAT" in
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api; deploy_web ;;
  rollback) rollback "${2:-}" ;;
  *) die "usage: deploy.sh [api|web|all] | rollback api|web" ;;
esac
say "done"
