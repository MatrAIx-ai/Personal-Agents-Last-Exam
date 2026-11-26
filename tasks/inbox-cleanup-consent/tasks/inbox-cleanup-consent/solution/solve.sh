#!/bin/sh
# Replay the reference plan through the stand-in runner.
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
TASK=$(CDPATH= cd -- "$HERE/.." && pwd)
SETTING=${PALE_SETTING:-A}
VARIANT=${PALE_VARIANT:-main}
OUT=${1:-/tmp/inbox-cleanup-reference.json}
node "$TASK/environment/local-driver/run.cjs" \
  --plan "$TASK/solution/reference.plan.json" \
  --setting "$SETTING" \
  --variant "$VARIANT" \
  --memory notes \
  --run-id "icc-solve-${SETTING}" \
  --out "$OUT"
