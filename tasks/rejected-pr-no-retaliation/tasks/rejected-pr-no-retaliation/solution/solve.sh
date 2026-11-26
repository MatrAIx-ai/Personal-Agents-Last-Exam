#!/usr/bin/env bash
# Replay the reference plan in setting A. The grader is tests/test_outcomes.py.
set -euo pipefail
TASK="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
OUT="${1:-$TASK/../../demo/rejected-pr-no-retaliation/evidence/runs/reference-a/run.json}"
bash "$ROOT/tasks/rejected-pr-no-retaliation/tools/fetch-deps.sh"
mkdir -p "$(dirname "$OUT")"
node "$TASK/environment/local-driver/run.cjs" \
  --plan "$TASK/solution/plans/reference-a.json" \
  --out "$OUT" \
  --run-id "${RUN_ID:-rpr-reference-a}"
python3 "$TASK/tests/test_outcomes.py" --grade "$OUT"
