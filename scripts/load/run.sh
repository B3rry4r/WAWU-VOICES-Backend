#!/usr/bin/env bash
# LCH-09: the whole measured run, one command. Run it when the machine is quiet (nothing else building or testing), or the
# numbers are skewed. Every step prints an EXIT line; the numbers land in $RUN (default /tmp/voices-load/lch-d).
#   scripts/load/run.sh full     build, bring the stack up, per-address limit table, the ramp, the shared-address run, stop (about 30 minutes)
#   scripts/load/run.sh dry      a one-minute check at small numbers that the harness works. A DRY RUN IS NOT A RESULT.
#   scripts/load/run.sh down     stop the stack
# Environment: SKIP_BUILD=1 reuses the last builds; KEEP=1 leaves the stack up afterwards; STAGES="5:90,10:90" changes the ramp
# (people starting a second : seconds); THINK=0.3 scales the pauses people take; LABEL=name names the result files.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/env.sh"
MODE="${1:-}"
LABEL="${LABEL:-$MODE}"
THINK="${THINK:-0.3}"
STAGES_DEFAULT="5:90,10:90,15:90,20:90,30:90,40:90,60:90,80:90,100:90,150:90,200:90"
DB_PLAIN="postgresql://postgres@127.0.0.1:$P_PG/$DB_NAME"
gen() { taskset -c "$GEN_CPUS" node "$HERE/$1" "${@:2}" --nginx-port "$P_NGINX" --id-port "$P_ID" --run "$RUN" --api-dir "$API_DIR"; }
quiet() { # name, cmd...  -> log, EXIT line
  local n=$1; shift; "$@" > "$RUN/logs/$n.log" 2>&1; local e=$?; echo "$n EXIT $e"; tail -3 "$RUN/logs/$n.log" | sed 's/^/    /'; return $e
}

case "$MODE" in
  down) "$HERE/stack.sh" down; exit 0 ;;
  full|dry) ;;
  *) echo "usage: run.sh full|dry|down" >&2; exit 2 ;;
esac
mkdir -p "$RUN/logs"
START=$(date +%s)
echo "== $MODE run, label $LABEL, app CPUs $APP_CPUS, generator CPUs $GEN_CPUS, think x$THINK"
echo "   load on this machine right now (1 min average, 4 CPUs): $(cut -d' ' -f1 /proc/loadavg)"
"$HERE/stack.sh" down > /dev/null 2>&1
if [ -z "${SKIP_BUILD:-}" ] && [ "$MODE" = full ]; then quiet build "$HERE/stack.sh" build || true; fi
quiet up "$HERE/stack.sh" up || { echo "stack did not come up; see $RUN/logs"; exit 1; }

if [ "$MODE" = dry ]; then
  echo "== DRY RUN: small numbers, one minute. Not a result."
  quiet cache-check gen check-cache.mjs || true
  quiet ramp-dry gen load.mjs --stages "1:15,2:30" --think "$THINK" --label "dry" --stop off --db "$DB_PLAIN" --redis-port "$P_REDIS"
  [ -n "${KEEP:-}" ] || "$HERE/stack.sh" down
  echo "dry run took $(( $(date +%s) - START )) s"
  exit 0
fi

echo "== the shared copies never carry a person's data (through nginx)"
quiet cache-check gen check-cache.mjs || true
echo "== per-address limits, one address at a time"
quiet limits gen limits.mjs suite --db "$DB_PLAIN" || true
echo "== the ramp: $STAGES_DEFAULT (override with STAGES)"
quiet ramp gen load.mjs --stages "${STAGES:-$STAGES_DEFAULT}" --think "$THINK" --label "$LABEL" --db "$DB_PLAIN" --redis-port "$P_REDIS" || true
echo "== a shared address: the same people, but only 3 addresses between them, 20 people a second for a minute"
quiet shared gen load.mjs --stages "20:60" --think "$THINK" --label "$LABEL-shared3" --sources 3 --stop off --db "$DB_PLAIN" --redis-port "$P_REDIS" || true
echo "== done in $(( ($(date +%s) - START) / 60 )) minutes. Results: $RUN/result-$LABEL.json, result-$LABEL-shared3.json, limits.json; logs in $RUN/logs"
[ -n "${KEEP:-}" ] || "$HERE/stack.sh" down
