# Restore a VOICES backup

Run as root on the droplet. The dump has no owners, so restoring it as the `voices` role makes `voices` own every table.

1. Load the settings: `set -a; . /etc/voices/api.env; . /etc/voices/backup.env; set +a`
2. Set the rclone remote from those names (the same ones backup.sh uses):
   ```
   export RCLONE_CONFIG_SPACES_TYPE=s3 RCLONE_CONFIG_SPACES_PROVIDER=DigitalOcean \
     RCLONE_CONFIG_SPACES_ACCESS_KEY_ID="$SPACES_KEY" RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY="$SPACES_SECRET" \
     RCLONE_CONFIG_SPACES_ENDPOINT="${SPACES_ENDPOINT:-https://${SPACES_REGION}.digitaloceanspaces.com}" \
     RCLONE_CONFIG_SPACES_REGION="$SPACES_REGION"
   ```
3. `rclone ls "SPACES:$SPACES_BACKUP_BUCKET/db"` and pick a file.
4. `rclone copyto "SPACES:$SPACES_BACKUP_BUCKET/db/<file>" /tmp/restore.sql.gz`
5. `systemctl stop voices-api`
6. `sudo -u postgres dropdb voices && sudo -u postgres createdb -O voices voices`
7. `gunzip -c /tmp/restore.sql.gz | psql "$DATABASE_URL"` (as the voices role, so it owns the tables)
8. `systemctl start voices-api`, then open https://usevoices.com/api/health and expect ok.
