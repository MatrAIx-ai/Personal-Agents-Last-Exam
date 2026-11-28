#!/usr/bin/env bash
# Verifier entry point. Grades the run exported by the runner (default /logs/agent/run.json) and
# writes /logs/verifier/reward.json + grading.json. Judge backend: PALE_JUDGE=heuristic (offline
# stand-in, default) | command (PALE_JUDGE_CMD, official) | cache (PALE_JUDGE_CACHE).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${PYTHON:-python3}"
RUN="${1:-${FLR_RUN_OUT:-/logs/agent/run.json}}"
OUT="${FLR_VERIFIER_OUT:-/logs/verifier}"
"$PY" "$HERE/test_outcomes.py" "$RUN" --out "$OUT"
