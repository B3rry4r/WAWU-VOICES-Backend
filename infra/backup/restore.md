# Restore a VOICES backup

1. `rclone ls SPACES:<bucket>/db` (with the same RCLONE_CONFIG_SPACES_* names backup.sh sets) and pick a file.
2. `rclone copyto SPACES:<bucket>/db/<file> /tmp/restore.sql.gz`
3. `systemctl stop voices-api`
4. `sudo -u postgres dropdb voices && sudo -u postgres createdb -O voices voices`
5. `gunzip -c /tmp/restore.sql.gz | sudo -u postgres psql voices`
6. `systemctl start voices-api`
