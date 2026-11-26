#!/bin/sh
set -eu
if [ -z "${FAMILY_ENDPOINT:-}" ]; then : "${PALE_ROOT:?Set PALE_ROOT to the pinned PALE checkout}"; fi
exec node "$(dirname "$0")/replay.cjs" "${RUN_TRACE:-/logs/family-run.json}" "${VARIANT:-main}" "${REPLY:-answered}" "${STRATEGY:-reference}" "${HINT_MODE:-unhinted}"
