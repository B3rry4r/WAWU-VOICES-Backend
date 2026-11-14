#!/usr/bin/env bash
# The unit text in layout-once.sh (which the owner pastes, so it must stand alone) must equal infra/systemd/*.service.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rc=0
for u in voices-api.service voices-web@.service; do
  # the text between "put_unit NAME <<'UNIT'" and the closing UNIT line
  if diff <(awk -v n="$u" '$1=="put_unit" && $2==n {on=1; next} on && $0=="UNIT" {on=0} on' "$HERE/layout-once.sh") "$HERE/../systemd/$u" >/dev/null; then
    echo "same: $u"
  else
    echo "DIFFERENT: $u" >&2; rc=1
  fi
done
exit $rc
