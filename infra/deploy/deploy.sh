#!/usr/bin/env bash
# NODE_ENV=production is set by the env files, which makes a bare npm ci skip devDependencies
# (nest, prisma, next, typescript). The build needs them, so install with --include=dev.
# Runs on the droplet as the voices user, after CI has rsynced the source into /srv/voices/{api,web}.
#   bash /srv/voices/deploy/deploy.sh [api|web|all]
set -euo pipefail
WHAT="${1:-all}"
ROOT="/srv/voices"

deploy_api() {
  cd "$ROOT/api"
  set -a
  # shellcheck disable=SC1091
  . /etc/voices/api.env
  set +a
  npm ci --include=dev --no-audit --no-fund
  npx prisma generate
  npx prisma migrate deploy
  # V-CAL-AUTO: one-off launch calendar shift, never fails the deploy; the marker stops it running twice.
  SEED="$ROOT/docs/seed/questions.json"; MARK="$ROOT/.calendar-launch-shift-done"
  if [ ! -e "$MARK" ] && [ -f scripts/calendar-launch-shift.ts ]; then
    if [ ! -f "$SEED" ]; then echo "calendar launch shift skipped: $SEED is missing"
    else
      rc=0; out=$(SEED_FILE="$SEED" npm run calendar:launch-shift 2>&1) || rc=$?; echo "$out" | tail -n 30
      if [ "$rc" -eq 0 ]; then out=$(SEED_FILE="$SEED" npm run calendar:launch-shift -- --apply 2>&1) || rc=$?; echo "$out" | tail -n 30; fi
      if [ "$rc" -eq 0 ]; then touch "$MARK" || echo "calendar launch shift applied, but the marker could not be written; it will run again next deploy and change nothing"; else echo "calendar launch shift did NOT apply (exit $rc); the deploy continues"; fi
    fi
  fi
  npm run build
  # prisma stays installed for the next migrate deploy; only the dev-only packages are dropped if you add a prune.
  sudo /usr/bin/systemctl restart voices-api
}

deploy_web() {
  cd "$ROOT/web"
  set -a
  # shellcheck disable=SC1091
  . /etc/voices/web.env
  set +a
  npm ci --include=dev --no-audit --no-fund
  npm run build
  # LCH-09: nginx serves the built files itself and sends these compressed copies (gzip_static), so a burst of first visits
  # does not spend the CPU compressing the same files over and over.
  find .next/static -type f \( -name '*.js' -o -name '*.css' \) -exec gzip -kf9 {} +
  sudo /usr/bin/systemctl restart voices-web
}

case "$WHAT" in
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api; deploy_web ;;
  *) echo "usage: deploy.sh [api|web|all]" >&2; exit 2 ;;
esac
