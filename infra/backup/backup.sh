#!/usr/bin/env bash
# Nightly pg_dump of the VOICES database to the VOICES backup Space, keeping BACKUP_KEEP_DAYS days.
# Reads DATABASE_URL and the SPACES_* names from the environment (systemd loads
# /etc/voices/api.env and /etc/voices/backup.env). Never prints a secret.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${SPACES_BACKUP_BUCKET:?SPACES_BACKUP_BUCKET is not set}"
: "${SPACES_REGION:?SPACES_REGION is not set}"
: "${SPACES_KEY:?SPACES_KEY is not set}"
: "${SPACES_SECRET:?SPACES_SECRET is not set}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
DIR="/var/backups/voices"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/voices-$STAMP.sql.gz"

# rclone reads its remote from the environment, so no config file holds the keys.
export RCLONE_CONFIG_SPACES_TYPE=s3
export RCLONE_CONFIG_SPACES_PROVIDER=DigitalOcean
export RCLONE_CONFIG_SPACES_ACCESS_KEY_ID="$SPACES_KEY"
export RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY="$SPACES_SECRET"
export RCLONE_CONFIG_SPACES_ENDPOINT="${SPACES_ENDPOINT:-https://${SPACES_REGION}.digitaloceanspaces.com}"
export RCLONE_CONFIG_SPACES_REGION="${SPACES_REGION}"
export RCLONE_CONFIG_SPACES_ACL=private

umask 077
mkdir -p "$DIR"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE"
# A dump that is nearly empty means something failed quietly.
if [ "$(stat -c %s "$FILE")" -lt 200 ]; then
  echo "Backup file is too small, not uploading." >&2
  rm -f "$FILE"
  exit 1
fi
rclone copyto "$FILE" "SPACES:${SPACES_BACKUP_BUCKET}/db/$(basename "$FILE")"
# Keep the newest KEEP_DAYS days in the Space and on disk.
rclone delete "SPACES:${SPACES_BACKUP_BUCKET}/db" --min-age "${KEEP_DAYS}d"
find "$DIR" -name 'voices-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete
echo "Backup ok: $(basename "$FILE")"
