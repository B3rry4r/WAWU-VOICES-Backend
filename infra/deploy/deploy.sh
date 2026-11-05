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
  sudo /usr/bin/systemctl restart voices-web
}

case "$WHAT" in
  api) deploy_api ;;
  web) deploy_web ;;
  all) deploy_api; deploy_web ;;
  *) echo "usage: deploy.sh [api|web|all]" >&2; exit 2 ;;
esac
