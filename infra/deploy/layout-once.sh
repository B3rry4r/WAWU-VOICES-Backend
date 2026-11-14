#!/usr/bin/env bash
# VOICES droplet, one-time change to the release layout (V-DEPLOY-SAFE). Run as root. Safe to run twice.
#   bash layout-once.sh
# All or nothing. It waits for a running deploy and holds the deploy lock until it is done. It then:
#   0. refuses, changing nothing, if /srv has less than 2 GB free
#   1. makes /srv/voices/releases/{api,web} and /srv/voices/web-static, owned by the voices user
#   2. copies the build that is running now into a first release (fresh from the current source on every run until it succeeds)
#   3. installs the new web unit (new file, nothing reads it yet), starts the two web servers (3001 and 3002) and waits for them
#   4. patches the live nginx site: two web servers, and /_next/static from /srv/voices/web-static. nginx -t first
#   5. last: sudo rights, the new API unit, one API restart (a few seconds of the busy page), stops the old web server
#      (port 3000), and only then writes /srv/voices/.layout-v2, which tells deploy.sh to use releases from now on
# If anything fails, every file it changed (units, sudoers, nginx site) is put back, the new web servers are stopped, and the
# old way of deploying works as before. The unit text below is the same as infra/systemd/*.service (check-units.sh checks).
set -euo pipefail

# These can be moved to a scratch folder to try the script on a test machine; on the droplet they are the defaults.
ROOT="${VOICES_ROOT:-/srv/voices}"
APP_USER="${VOICES_USER:-voices}"
UNIT_DIR="${VOICES_UNIT_DIR:-/etc/systemd/system}"
SUDOERS="${VOICES_SUDOERS:-/etc/sudoers.d/voices}"
NGINX_SITES="${VOICES_NGINX_SITES:-/etc/nginx/sites-available /etc/nginx/conf.d}"
BACKUP_DIR="${VOICES_BACKUP_DIR:-/root}"
MIN_FREE_KB="${VOICES_MIN_FREE_KB:-2097152}"
WAIT_SECS="${VOICES_WAIT_SECS:-90}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BK=""; DONE=0; SITE=""; API_RESTARTED=0; OLDWEB_STOPPED=0; STARTED_WEB=(); NGINX_RELOADED=0

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
id "$APP_USER" >/dev/null 2>&1 || { echo "No $APP_USER user: run infra/provision.sh first." >&2; exit 1; }
command -v nginx >/dev/null || { echo "nginx is not installed." >&2; exit 1; }

if [ -e "$ROOT/.layout-v2" ]; then
  echo "Already in place ($ROOT/.layout-v2 exists): nothing to do, nothing was touched."
  exit 0
fi

echo "== 0. space, and the deploy lock"
mkdir -p "$ROOT"
FREE_KB="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
if [ "${FREE_KB:-0}" -lt "$MIN_FREE_KB" ]; then
  echo "NOT DONE, nothing was changed: $ROOT has $((FREE_KB / 1024)) MB free and this needs at least $((MIN_FREE_KB / 1024)) MB (it keeps a copy of the current builds). Free some space and run it again." >&2
  exit 1
fi
echo "free: $((FREE_KB / 1024)) MB"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$ROOT" "$ROOT/deploy"
# deploy.sh runs as the voices user and opens this file for writing, so it must be theirs.
touch "$ROOT/deploy/.lock"; chown "$APP_USER:$APP_USER" "$ROOT/deploy/.lock"; chmod 664 "$ROOT/deploy/.lock"
exec 9> "$ROOT/deploy/.lock"
if ! flock -n 9; then
  echo "A deploy is running right now. Waiting for it to finish (up to 30 minutes), then this goes on..."
  flock -w "${VOICES_LOCK_WAIT:-1800}" 9 || { echo "Still waiting after the limit: a deploy is still running. Nothing was changed. Run this again in a few minutes." >&2; exit 1; }
  echo "The deploy finished. Going on."
fi

BK="$BACKUP_DIR/voices-layout-backup-$STAMP"
mkdir -p "$BK"
backup_file() { # path: remember how it was (or that it was not there), once
  local n; n="$(echo "$1" | tr / _)"
  if [ -e "$BK/$n" ] || [ -e "$BK/$n.absent" ]; then return 0; fi
  if [ -e "$1" ]; then cp -a "$1" "$BK/$n"; else : > "$BK/$n.absent"; fi
}
restore_file() {
  local n; n="$(echo "$1" | tr / _)"
  if [ -e "$BK/$n" ]; then cp -a "$BK/$n" "$1"; elif [ -e "$BK/$n.absent" ]; then rm -f "$1"; fi
}
SUDOERS_FILE_LIST=("$SUDOERS" "$UNIT_DIR/voices-api.service" "$UNIT_DIR/voices-web.service" "$UNIT_DIR/voices-web@.service")

on_exit() {
  local rc=$?
  [ "$DONE" = 1 ] && return 0
  trap - EXIT ERR
  echo >&2
  echo "FAILED (exit $rc). Putting everything back the way it was..." >&2
  set +e
  for f in "${SUDOERS_FILE_LIST[@]}"; do restore_file "$f"; done
  if [ -n "$SITE" ]; then
    restore_file "$SITE"
    if [ "$NGINX_RELOADED" = 1 ]; then nginx -t >/dev/null 2>&1 && systemctl reload nginx; fi
  fi
  # only what this run started: a server that was already running before it began is never stopped here
  for u in "${STARTED_WEB[@]}"; do systemctl disable --now "$u" >/dev/null 2>&1; done
  systemctl daemon-reload
  if [ "$OLDWEB_STOPPED" = 1 ]; then systemctl enable --now voices-web >/dev/null 2>&1; fi
  if [ "$API_RESTARTED" = 1 ]; then systemctl restart voices-api; fi
  echo "Restored: unit files, sudo rights, nginx site. Nothing is switched over; deploys work the old way (a changed .layout-v2 was never written). Fix the cause above and run this again." >&2
  exit "$rc"
}
trap on_exit EXIT
trap 'echo "FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

as_app() { runuser -u "$APP_USER" -- "$@"; }
wait_http() { # url, seconds, regex
  local i code=000
  for ((i = 0; i < $2 * 2; i++)); do
    code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$1" 2>/dev/null || true)
    [[ "$code" =~ $3 ]] && return 0
    sleep 0.5
  done
  echo "$1 answered $code, wanted $3" >&2
  return 1
}
point() { ln -sfn "$2" "$1.tmp.$$" && mv -Tf "$1.tmp.$$" "$1"; chown -h "$APP_USER:$APP_USER" "$1"; }
put_unit() { # name, then the text on stdin
  local f="$UNIT_DIR/$1" tmp; tmp="$(mktemp)"
  cat > "$tmp"
  if [ -f "$f" ] && cmp -s "$tmp" "$f"; then rm -f "$tmp"; return 0; fi
  backup_file "$f"
  install -m 644 "$tmp" "$f"; rm -f "$tmp"
}
for f in "${SUDOERS_FILE_LIST[@]}"; do backup_file "$f"; done

echo "== 1. folders"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$ROOT/releases" "$ROOT/releases/api" "$ROOT/releases/web" "$ROOT/web-static"
# CI rsyncs here as the voices user and the units run as that user, so the source folders are the user's too.
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$ROOT/api" "$ROOT/web"

echo "== 2. first release from the build that is running now"
SEEDED_WEB=0; SEEDED_API=0
if [ ! -e "$ROOT/.layout-v2" ]; then
  # Not finished before (or never started): drop the copies and links of an earlier try, so what is copied now is the current source.
  rm -rf "$ROOT"/releases/web/*-seed "$ROOT"/releases/api/*-seed
  rm -f "$ROOT/web-current" "$ROOT/api-current"
  if [ -f "$ROOT/web/.next/BUILD_ID" ] && [ -d "$ROOT/web/node_modules" ]; then
    REL="$ROOT/releases/web/${STAMP}-seed"
    mkdir -p "$REL"
    # a copy, not a move: the old web server is still running from these files
    tar -C "$ROOT/web" --exclude='./.env' --exclude='./.env.*' -cf - . | tar -C "$REL" -xf -
    chown -R "$APP_USER:$APP_USER" "$REL"
    touch "$REL/.ok"; chown "$APP_USER:$APP_USER" "$REL/.ok"
    point "$ROOT/web-current" "$REL"
    SEEDED_WEB=1
    echo "web: $REL"
  else
    echo "web: no build in $ROOT/web, nothing to copy (the first deploy makes the first release)"
  fi
  if [ -f "$ROOT/api/dist/main.js" ] && [ -d "$ROOT/api/node_modules" ]; then
    REL="$ROOT/releases/api/${STAMP}-seed"
    mkdir -p "$REL"
    tar -C "$ROOT/api" --exclude='./.env' --exclude='./.env.*' -cf - . | tar -C "$REL" -xf -
    chown -R "$APP_USER:$APP_USER" "$REL"
    touch "$REL/.ok"; chown "$APP_USER:$APP_USER" "$REL/.ok"
    point "$ROOT/api-current" "$REL"
    SEEDED_API=1
    echo "api: $REL"
  else
    echo "api: no build in $ROOT/api, nothing to copy (the first deploy makes the first release)"
  fi
fi
# Every file of the release goes into the shared static folder (adding only, never replacing).
if [ -d "$ROOT/web-current/.next/static" ]; then
  tar -C "$ROOT/web-current/.next/static" -cf - . | tar -C "$ROOT/web-static" -xf - --skip-old-files
fi
chown -R "$APP_USER:$APP_USER" "$ROOT/web-static"
chmod 755 "$ROOT/web-static"
find "$ROOT/web-static" -type d -exec chmod 755 {} +
find "$ROOT/web-static" -type f -exec chmod a+r {} +

echo "== 3. the two web servers (a new unit; nothing reads it yet)"
put_unit voices-web@.service <<'UNIT'
[Unit]
Description=VOICES web (Next.js) on port %i
After=network.target voices-api.service

[Service]
Type=simple
User=voices
Group=voices
# V-DEPLOY-SAFE: two copies run (3001 and 3002) so a deploy restarts them one at a time. The folder is the live release.
WorkingDirectory=/srv/voices/web-current
EnvironmentFile=/etc/voices/web.env
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p %i
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
for u in voices-web@3001 voices-web@3002; do
  systemctl is-active --quiet "$u" 2>/dev/null || STARTED_WEB+=("$u")
done
systemctl enable voices-web@3001 voices-web@3002 >/dev/null 2>&1
if [ -L "$ROOT/web-current" ]; then
  # start does nothing to a server that already runs; a changed unit file takes effect at the deploy's next restart
  systemctl start voices-web@3001 voices-web@3002
  wait_http http://127.0.0.1:3001/ "$WAIT_SECS" '^[23]'
  wait_http http://127.0.0.1:3002/ "$WAIT_SECS" '^[23]'
  echo "web servers on 3001 and 3002 answer"
fi

echo "== 4. nginx"
for d in $NGINX_SITES; do
  [ -d "$d" ] || continue
  f="$(grep -l 'upstream voices_web' "$d"/* 2>/dev/null | head -1 || true)"
  [ -n "$f" ] && { SITE="$f"; break; }
done
[ -n "$SITE" ] || { echo "Could not find the nginx site file (the one with 'upstream voices_web')." >&2; exit 1; }
backup_file "$SITE"
cp -a "$SITE" "$BACKUP_DIR/voices-nginx-site-before-layout-$STAMP.conf"
if ! grep -q '127.0.0.1:3001' "$SITE"; then
  sed -i '/upstream voices_web {/,/^}/{s|^\( *\)server 127.0.0.1:3000;|\1server 127.0.0.1:3001 max_fails=0;\n\1server 127.0.0.1:3002 max_fails=0;|}' "$SITE"
fi
sed -i 's|alias [^;]*/\.next/static/;|alias '"$ROOT"'/web-static/;|' "$SITE"
if ! grep -q '127.0.0.1:3001' "$SITE" || ! grep -q "alias $ROOT/web-static/;" "$SITE"; then
  echo "The nginx site file is not in the shape this script expects. Nothing is switched over." >&2
  exit 1
fi
if ! NGINX_OUT="$(nginx -t 2>&1)"; then
  echo "nginx -t FAILED. nginx said:" >&2
  echo "$NGINX_OUT" >&2
  exit 1
fi
systemctl reload nginx
NGINX_RELOADED=1
echo "nginx reloaded (old file saved as $BACKUP_DIR/voices-nginx-site-before-layout-$STAMP.conf)"

echo "== 5. last: sudo rights, the API unit, the old web server, the marker"
TMP_SUDO="$(mktemp)"
cat > "$TMP_SUDO" <<'SUDO'
voices ALL=(root) NOPASSWD: /usr/bin/systemctl restart voices-api, /usr/bin/systemctl restart voices-web@3001, /usr/bin/systemctl restart voices-web@3002, /usr/bin/systemctl is-active voices-api, /usr/bin/systemctl is-active voices-web@3001, /usr/bin/systemctl is-active voices-web@3002
SUDO
visudo -cf "$TMP_SUDO" >/dev/null
install -m 440 "$TMP_SUDO" "$SUDOERS"; rm -f "$TMP_SUDO"
# The API unit is installed here, with the restart right after it: only now does anything start from api-current.
put_unit voices-api.service <<'UNIT'
[Unit]
Description=VOICES API (NestJS)
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=voices
Group=voices
# V-DEPLOY-SAFE: the live release (a symlink deploy.sh switches), not the folder CI rsyncs the source into.
WorkingDirectory=/srv/voices/api-current
EnvironmentFile=/etc/voices/api.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable voices-api >/dev/null 2>&1
if [ -L "$ROOT/api-current" ] && [ ! -e "$ROOT/.layout-v2" ]; then
  API_RESTARTED=1
  systemctl restart voices-api
  wait_http http://127.0.0.1:4000/api/health "$WAIT_SECS" '^200$'
  echo "API runs from its first release"
fi
if [ -L "$ROOT/web-current" ] && systemctl list-unit-files voices-web.service 2>/dev/null | grep -q '^voices-web.service'; then
  OLDWEB_STOPPED=1
  systemctl disable --now voices-web >/dev/null 2>&1 || true
fi
rm -f "$UNIT_DIR/voices-web.service"
systemctl daemon-reload

touch "$ROOT/.layout-v2"
DONE=1
echo "== done: switch deploy.sh to releases, free the old build folders"
if [ "$SEEDED_WEB" = 1 ]; then rm -rf "$ROOT/web/node_modules" "$ROOT/web/.next" || true; fi
if [ "$SEEDED_API" = 1 ]; then rm -rf "$ROOT/api/node_modules" "$ROOT/api/dist" "$ROOT/api/src/generated" || true; fi
echo "OK: releases layout is in place. Deploys now build in $ROOT/releases and switch a link."
