#!/bin/sh
# Grades one exported trace. Harbor path: written, not run.
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
RUN=${1:-${PALE_RUN:-/logs/agent/run.json}}
OUT=${PALE_VERIFIER_OUT:-/logs/verifier}
mkdir -p "$OUT"
node "$HERE/grade.cjs" "$RUN" --out "$OUT"
