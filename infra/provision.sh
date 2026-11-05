#!/usr/bin/env bash
# VOICES droplet provisioning (V-2). Ubuntu 24.04. Run once as root; safe to run again.
#   bash provision.sh
# Installs Node 20 LTS, nginx, PostgreSQL 16, Redis 7, ffmpeg, ufw, certbot, rclone.
# Creates the voices user, the app folders, the database and role, and installs the
# nginx site and the systemd units from this repo's infra/ folder (next to this script).
# It never writes a secret: it creates /etc/voices/*.env from the examples only when missing,
# with a generated database password, and leaves every other value for the owner to fill in.
set -euo pipefail

DOMAIN="${VOICES_DOMAIN:-voices.wawuafrica.com}"
APP_USER="voices"
APP_ROOT="/srv/voices"
ENV_DIR="/etc/voices"
DB_NAME="voices"
DB_USER="voices"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi
if ! grep -q 'VERSION_ID="24.04"' /etc/os-release; then
  echo "This script is for Ubuntu 24.04." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw nginx redis-server ffmpeg certbot \
  python3-certbot-nginx rsync rclone postgresql postgresql-contrib build-essential git

# The ffmpeg package ships both ffmpeg and ffprobe; the server normalises audio with them.
for tool in ffmpeg ffprobe; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is missing after install." >&2; exit 1; }
done

echo "== node 20"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\.'; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

echo "== postgresql 16"
# Ubuntu 24.04 ships PostgreSQL 16 in its own repository.
if ! psql --version | grep -q ' 16\.'; then
  echo "Expected PostgreSQL 16 from Ubuntu 24.04." >&2
  exit 1
fi
systemctl enable --now postgresql

echo "== redis (local only, no password needed on 127.0.0.1)"
sed -i 's/^# *bind 127.0.0.1.*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
sed -i 's/^supervised .*/supervised systemd/' /etc/redis/redis.conf
systemctl enable redis-server
systemctl restart redis-server

echo "== voices user and folders"
if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$APP_ROOT" --shell /bin/bash "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_ROOT" "$APP_ROOT/api" "$APP_ROOT/web" "$APP_ROOT/deploy"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$APP_ROOT/.ssh"
install -d -o root -g "$APP_USER" -m 750 "$ENV_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 /var/backups/voices

echo "== database and role"
ENV_API="$ENV_DIR/api.env"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  DB_PASS="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'"
  DB_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"
  FRESH_DB_URL="$DB_URL"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

echo "== env files (created only when missing)"
if [ ! -f "$ENV_API" ]; then
  install -m 640 -o root -g "$APP_USER" "$HERE/env/api.env.example" "$ENV_API"
  if [ -n "${FRESH_DB_URL:-}" ]; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${FRESH_DB_URL}|" "$ENV_API"
  fi
fi
if [ ! -f "$ENV_DIR/web.env" ]; then
  install -m 640 -o root -g "$APP_USER" "$HERE/env/web.env.example" "$ENV_DIR/web.env"
fi
if [ ! -f "$ENV_DIR/backup.env" ]; then
  install -m 640 -o root -g "$APP_USER" "$HERE/env/backup.env.example" "$ENV_DIR/backup.env"
fi

echo "== deploy script and backup"
install -m 755 -o "$APP_USER" -g "$APP_USER" "$HERE/deploy/deploy.sh" "$APP_ROOT/deploy/deploy.sh"
install -m 755 "$HERE/backup/backup.sh" /usr/local/bin/voices-backup
install -m 644 "$HERE/systemd/voices-backup.service" /etc/systemd/system/voices-backup.service
install -m 644 "$HERE/systemd/voices-backup.timer" /etc/systemd/system/voices-backup.timer

echo "== systemd units"
install -m 644 "$HERE/systemd/voices-api.service" /etc/systemd/system/voices-api.service
install -m 644 "$HERE/systemd/voices-web.service" /etc/systemd/system/voices-web.service
# The voices user may restart only its own two services, no password.
cat > /etc/sudoers.d/voices <<'SUDO'
voices ALL=(root) NOPASSWD: /usr/bin/systemctl restart voices-api, /usr/bin/systemctl restart voices-web, /usr/bin/systemctl is-active voices-api, /usr/bin/systemctl is-active voices-web
SUDO
chmod 440 /etc/sudoers.d/voices
visudo -cf /etc/sudoers.d/voices
systemctl daemon-reload
systemctl enable voices-api voices-web
systemctl enable --now voices-backup.timer

echo "== nginx"
# Copy the site file only when it is missing: certbot adds the 443 block to it, and a re-run must keep that.
if [ ! -f /etc/nginx/sites-available/voices.conf ]; then
  sed "s/__DOMAIN__/${DOMAIN}/g" "$HERE/nginx/voices.conf" > /etc/nginx/sites-available/voices.conf
fi
ln -sf /etc/nginx/sites-available/voices.conf /etc/nginx/sites-enabled/voices.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "== firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "== tls (only when the DNS record already points here)"
SERVER_IP="$(curl -fsS https://api.ipify.org || true)"
DNS_IP="$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)"
if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" = "$DNS_IP" ]; then
  if [ -z "${CERTBOT_EMAIL:-}" ]; then
    echo "Set CERTBOT_EMAIL=you@example.com and run again to get the certificate."
  elif [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
  fi
else
  echo "DNS for $DOMAIN does not point at this server yet ($DNS_IP vs $SERVER_IP). Skipping certbot; run again after the DNS record is live."
fi

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "== tls install (certificate exists; keep HTTPS in the nginx site)"
  certbot install --nginx -d "$DOMAIN" --non-interactive --redirect
  nginx -t
  systemctl reload nginx
fi

echo "Done. Next: fill in $ENV_DIR/api.env, web.env and backup.env, then add the deploy key (see RUNBOOK.md)."
