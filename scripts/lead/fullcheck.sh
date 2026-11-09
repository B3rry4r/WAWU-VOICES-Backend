#!/usr/bin/env bash
# The lead's full check on joined code, for both VOICES repos. Every step prints an EXIT line; push only on all EXIT 0.
#   scripts/lead/fullcheck.sh <backend-ref> <web-ref> <tag>
# Needs: scripts/dev/services.sh up (Postgres 14001, Redis 14002), node_modules installed in the two main clones
# (BACKEND_DIR/api and WEB_DIR). Uses a fresh test database and Redis db 14; cleans up after itself.
set -u
BREF=$1; WREF=$2; TAG=$3
BACKEND_DIR=${BACKEND_DIR:-/home/user/wawu-voices-backend}
WEB_DIR=${WEB_DIR:-/home/user/wawu-voices-web}
L=${LOG_DIR:-/tmp/voices-fullcheck}/$TAG; mkdir -p "$L"
WB=/home/user/wt/lead-$TAG-backend; WW=/home/user/wt/lead-$TAG-web
git -C "$BACKEND_DIR" fetch -q origin; git -C "$WEB_DIR" fetch -q origin
git -C "$BACKEND_DIR" worktree add -q "$WB" "$BREF"
git -C "$WEB_DIR" worktree add -q "$WW" "$WREF"
ln -s "$BACKEND_DIR/api/node_modules" "$WB/api/node_modules"
ln -s "$WEB_DIR/node_modules" "$WW/node_modules"
unset VOICES_PHONE_PEPPER SPACES_KEY SPACES_SECRET SPACES_BUCKET SPACES_ENDPOINT SPACES_REGION NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_WAWU_ID_BASE
cd "$WB/api"
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:14001/voices_test_lead_$TAG?schema=public"
export REDIS_URL="redis://localhost:14002/14"
npx prisma generate > "$L/api-gen.log" 2>&1; echo "APIGEN EXIT $?" >> "$L/api-gen.log"
npx tsc --noEmit > "$L/api-tsc.log" 2>&1; echo "APITSC EXIT $?" >> "$L/api-tsc.log"
npx eslint "{src,test}/**/*.ts" > "$L/api-lint.log" 2>&1; echo "APILINT EXIT $?" >> "$L/api-lint.log"
npm test > "$L/api-test.log" 2>&1; echo "APITEST EXIT $?" >> "$L/api-test.log"
npm run build > "$L/api-build.log" 2>&1; echo "APIBUILD EXIT $?" >> "$L/api-build.log"
cd "$WW"
VOICES_BACKEND_DIR="$WB" node scripts/sync-shared.mjs --check > "$L/web-sync.log" 2>&1; echo "WEBSYNC EXIT $?" >> "$L/web-sync.log"
npx tsc --noEmit > "$L/web-tsc.log" 2>&1; echo "WEBTSC EXIT $?" >> "$L/web-tsc.log"
npx next lint > "$L/web-lint.log" 2>&1; echo "WEBLINT EXIT $?" >> "$L/web-lint.log"
npx vitest run > "$L/web-test.log" 2>&1; echo "WEBTEST EXIT $?" >> "$L/web-test.log"
NEXT_PUBLIC_API_BASE_URL=/api/v1 npx next build > "$L/web-build.log" 2>&1; echo "WEBBUILD EXIT $?" >> "$L/web-build.log"
rm -f "$WB/api/node_modules" "$WW/node_modules"; rm -rf "$WW/.next" "$WB/api/dist"
git -C "$BACKEND_DIR" worktree remove --force "$WB"; git -C "$WEB_DIR" worktree remove --force "$WW"
psql -h localhost -p 14001 -U postgres -c "DROP DATABASE IF EXISTS voices_test_lead_$TAG" > /dev/null 2>&1
grep -h EXIT "$L"/*.log
grep -hE "^Tests:|^Test Suites:" "$L/api-test.log"; grep -hE "Test Files|Tests " "$L/web-test.log"
