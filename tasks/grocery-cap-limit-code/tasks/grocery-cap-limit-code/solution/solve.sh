#!/bin/sh
# Replay the reference plan through the package stand-in and grade it.
set -eu
TASK=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT=${1:-/tmp/grocery-cap-reference}
node "$TASK/local-driver/run.cjs" --plan "$TASK/solution/plans/reference.json" --out "$OUT" --run-id gclreference
python3 "$TASK/tests/test_outcomes.py" --state "$OUT/state.json" --out "$OUT/reward.json"
