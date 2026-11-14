#!/usr/bin/env bash
# VOICES droplet, one-time change to the release layout (V-DEPLOY-SAFE). Run as root. Safe to run twice.
#   bash layout-once.sh
# What it does, in this order (nothing live changes until step 3, and the site keeps answering throughout):
#   1. makes /srv/voices/releases/{api,web} and /srv/voices/web-static, owned by the voices user
#   2. turns the build that is running now into the first release (a copy; the old folders are left alone until the end)
#   3. installs the new systemd units, starts the two web servers (3001 and 3002) on the first release, and waits for them
#   4. patches the live nginx site: two web servers, and /_next/static from /srv/voices/web-static. nginx -t first; on a
#      failure it puts the old file back and stops, with nginx's own message
#   5. stops the old single web server (port 3000), lets the voices user restart the new units, and restarts the API once
#      on its first release (a few seconds with the busy answer, one time only)
#   6. writes /srv/voices/.layout-v2, which tells deploy.sh to use releases from now on, and frees the old build folders
# provision.sh runs this too. The unit text below is the same as infra/systemd/*.service (infra/deploy/check-units.sh checks).
set -euo pipefail
trap 'echo "FAILED at line $LINENO: $BASH_COMMAND" >&2' ERR

# These can be moved to a scratch folder to try the script on a test machine; on the droplet they are the defaults.
ROOT="${VOICES_ROOT:-/srv/voices}"
APP_USER="${VOICES_USER:-voices}"
UNIT_DIR="${VOICES_UNIT_DIR:-/etc/systemd/system}"
SUDOERS="${VOICES_SUDOERS:-/etc/sudoers.d/voices}"
NGINX_SITES="${VOICES_NGINX_SITES:-/etc/nginx/sites-available /etc/nginx/conf.d}"
BACKUP_DIR="${VOICES_BACKUP_DIR:-/root}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
id "$APP_USER" >/dev/null 2>&1 || { echo "No $APP_USER user: run infra/provision.sh first." >&2; exit 1; }
command -v nginx >/dev/null || { echo "nginx is not installed." >&2; exit 1; }

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

echo "== 1. folders"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$ROOT" "$ROOT/deploy" "$ROOT/releases" "$ROOT/releases/api" "$ROOT/releases/web" "$ROOT/web-static"
# CI rsyncs here as the voices user and the units run as that user, so the source folders are the user's too.
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$ROOT/api" "$ROOT/web"

echo "== 2. first release from the build that is running now"
SEEDED_WEB=0; SEEDED_API=0
if [ ! -L "$ROOT/web-current" ]; then
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
    echo "web: no build in $ROOT/web, nothing to seed (the first deploy makes the first release)"
  fi
fi
# Every file of the seed goes into the shared static folder, whether or not this is the first run.
if [ -d "$ROOT/web-current/.next/static" ]; then
  tar -C "$ROOT/web-current/.next/static" -cf - . | tar -C "$ROOT/web-static" -xf - --skip-old-files
fi
chown -R "$APP_USER:$APP_USER" "$ROOT/web-static"
chmod 755 "$ROOT/web-static"
find "$ROOT/web-static" -type d -exec chmod 755 {} +
find "$ROOT/web-static" -type f -exec chmod a+r {} +
if [ ! -L "$ROOT/api-current" ]; then
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
    echo "api: no build in $ROOT/api, nothing to seed (the first deploy makes the first release)"
  fi
fi

echo "== 3. systemd units, and the two web servers"
UNITS_CHANGED=0
put_unit() { # name, then the text on stdin
  local f="$UNIT_DIR/$1" tmp; tmp="$(mktemp)"
  cat > "$tmp"
  if [ -f "$f" ] && cmp -s "$tmp" "$f"; then rm -f "$tmp"; return 0; fi
  install -m 644 "$tmp" "$f"; rm -f "$tmp"; UNITS_CHANGED=1
}
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
systemctl enable voices-api voices-web@3001 voices-web@3002 >/dev/null 2>&1
if [ -L "$ROOT/web-current" ]; then
  # start does nothing to a server that already runs; a changed unit file takes effect at the deploy's next restart
  systemctl start voices-web@3001 voices-web@3002
  wait_http http://127.0.0.1:3001/ 90 '^[23]'
  wait_http http://127.0.0.1:3002/ 90 '^[23]'
  echo "web servers on 3001 and 3002 answer"
fi

echo "== 4. nginx"
SITE=""
for d in $NGINX_SITES; do
  [ -d "$d" ] || continue
  f="$(grep -l 'upstream voices_web' "$d"/* 2>/dev/null | head -1 || true)"
  [ -n "$f" ] && { SITE="$f"; break; }
done
[ -n "$SITE" ] || { echo "Could not find the nginx site file (the one with 'upstream voices_web')." >&2; exit 1; }
BACKUP="$BACKUP_DIR/voices-nginx-site-before-layout-$STAMP.conf"
cp -a "$SITE" "$BACKUP"
if ! grep -q '127.0.0.1:3001' "$SITE"; then
  sed -i '/upstream voices_web {/,/^}/{s|^\( *\)server 127.0.0.1:3000;|\1server 127.0.0.1:3001 max_fails=0;\n\1server 127.0.0.1:3002 max_fails=0;|}' "$SITE"
fi
sed -i 's|alias [^;]*/\.next/static/;|alias '"$ROOT"'/web-static/;|' "$SITE"
if ! grep -q '127.0.0.1:3001' "$SITE" || ! grep -q "alias $ROOT/web-static/;" "$SITE"; then
  cp -a "$BACKUP" "$SITE"
  echo "The nginx site file is not in the shape this script expects, so it was left as it was. Nothing is switched over." >&2
  exit 1
fi
if ! NGINX_OUT="$(nginx -t 2>&1)"; then
  cp -a "$BACKUP" "$SITE"
  echo "nginx -t FAILED, the old site file is back and nginx was not reloaded. nginx said:" >&2
  echo "$NGINX_OUT" >&2
  exit 1
fi
if [ -d "$ROOT/web-current" ]; then
  systemctl reload nginx
  echo "nginx reloaded (old file saved as $BACKUP)"
else
  echo "nginx file patched, not reloaded: nothing is built yet, the first deploy will start the web servers (old file saved as $BACKUP)"
fi

echo "== 5. old web server, sudo rights, API"
if [ -L "$ROOT/web-current" ] && systemctl list-unit-files voices-web.service 2>/dev/null | grep -q '^voices-web.service'; then
  systemctl disable --now voices-web >/dev/null 2>&1 || true
fi
rm -f "$UNIT_DIR/voices-web.service"
systemctl daemon-reload
TMP_SUDO="$(mktemp)"
cat > "$TMP_SUDO" <<'SUDO'
voices ALL=(root) NOPASSWD: /usr/bin/systemctl restart voices-api, /usr/bin/systemctl restart voices-web@3001, /usr/bin/systemctl restart voices-web@3002, /usr/bin/systemctl is-active voices-api, /usr/bin/systemctl is-active voices-web@3001, /usr/bin/systemctl is-active voices-web@3002
SUDO
visudo -cf "$TMP_SUDO" >/dev/null
install -m 440 "$TMP_SUDO" "$SUDOERS"; rm -f "$TMP_SUDO"
if [ -L "$ROOT/api-current" ] && { [ "$SEEDED_API" = 1 ] || [ "$UNITS_CHANGED" = 1 ] || [ ! -e "$ROOT/.layout-v2" ]; }; then
  systemctl restart voices-api
  wait_http http://127.0.0.1:4000/api/health 90 '^200$'
  echo "API runs from its first release"
fi

echo "== 6. switch deploy.sh to releases, free the old build folders"
touch "$ROOT/.layout-v2"
if [ "$SEEDED_WEB" = 1 ]; then rm -rf "$ROOT/web/node_modules" "$ROOT/web/.next"; fi
if [ "$SEEDED_API" = 1 ]; then rm -rf "$ROOT/api/node_modules" "$ROOT/api/dist" "$ROOT/api/src/generated"; fi
echo "OK: releases layout is in place. Deploys now build in $ROOT/releases and switch a link."
