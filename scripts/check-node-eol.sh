#!/usr/bin/env bash
# Node-LTS + action-version refresh reminder (moot-894).
#
# Reads the node-version pinned in .github/workflows/deploy.yml, looks up that
# major's LTS end-of-life date, and exits non-zero when EOL is within
# EOL_WARN_DAYS. On a monthly schedule a non-zero exit emails the repo owner —
# the reminder to bump node-version and the pinned action majors together (see
# docs/operations.md "Node LTS & action-version cadence"). Runs locally too.
#
#   EOL_WARN_DAYS=180 ./scripts/check-node-eol.sh
set -euo pipefail

WORKFLOW="${WORKFLOW:-.github/workflows/deploy.yml}"
EOL_WARN_DAYS="${EOL_WARN_DAYS:-180}"

# Node even-major LTS end-of-life dates (schedule.json / nodejs.org/en/about/previous-releases).
# When you bump to a new major, add its EOL here.
eol_for_major() {
  case "$1" in
    18) echo "2025-04-30" ;;
    20) echo "2026-04-30" ;;
    22) echo "2027-04-30" ;;
    24) echo "2028-04-30" ;;
    26) echo "2029-04-30" ;;
    *)  echo "" ;;
  esac
}

# Pinned major from `node-version: NN` in the workflow.
major="$(grep -oE 'node-version:[[:space:]]*[0-9]+' "$WORKFLOW" | grep -oE '[0-9]+$' | head -1 || true)"
if [ -z "$major" ]; then
  echo "REMINDER: could not read node-version from $WORKFLOW — check the pin manually"
  exit 1
fi

eol="$(eol_for_major "$major")"
if [ -z "$eol" ]; then
  echo "REMINDER: Node $major has no EOL date recorded in $(basename "$0") — add it, then re-run"
  exit 1
fi

eol_epoch="$(date -d "$eol" +%s)"
now_epoch="$(date +%s)"
days_left=$(( (eol_epoch - now_epoch) / 86400 ))

if [ "$days_left" -lt "$EOL_WARN_DAYS" ]; then
  echo "REMINDER: Node $major reaches EOL in ${days_left}d (${eol})."
  echo "  Bump node-version and the pinned action majors together in $WORKFLOW,"
  echo "  update docs/operations.md, and add the new major's EOL to this script."
  exit 1
fi

echo "OK: Node $major EOL ${eol} — ${days_left}d away (warns under ${EOL_WARN_DAYS}d)."
exit 0
