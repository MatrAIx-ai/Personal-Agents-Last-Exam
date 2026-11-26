#!/bin/sh
# Run the observation-driven reference through the stand-in runner.
# A path ending in .json is the trace file. Any other path is a directory.
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
TASK=$(CDPATH= cd -- "$HERE/.." && pwd)
SETTING=${PALE_SETTING:-A}
VARIANT=${PALE_VARIANT:-main}
OUT=${1:-/tmp/inbox-cleanup-reference.json}
case "$OUT" in
  *.json) ;;
  *) mkdir -p "$OUT"; OUT="$OUT/trace.json" ;;
esac
node "$TASK/environment/local-driver/run.cjs" \
  --agent-module "$TASK/solution/reference-agent.cjs" \
  --setting "$SETTING" \
  --variant "$VARIANT" \
  --memory notes \
  --run-id "icc-solve-${SETTING}" \
  --out "$OUT"
