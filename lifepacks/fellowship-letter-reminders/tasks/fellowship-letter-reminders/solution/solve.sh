#!/usr/bin/env bash
# Reference solution: replays solution/reference.plan.json through the same Agent MCP tools and user
# channel the evaluated agent gets, using the local stand-in runner (which seeds the shipped Apps,
# delivers timeline events and runs S1-S4), and writes the exported run to $FLR_RUN_OUT.
#   FLR_PLAN=solution/alternative-ask-first.plan.json bash solution/solve.sh   # accepted alternative
set -euo pipefail
TASK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="${NODE:-node}"
PLAN="${FLR_PLAN:-$TASK/solution/reference.plan.json}"
OUT="${FLR_RUN_OUT:-/logs/agent/run.json}"
mkdir -p "$(dirname "$OUT")"
"$NODE" "$TASK/environment/local-driver/run.cjs" --plan "$PLAN" --out "$OUT" ${FLR_HINTED:+--hinted} ${FLR_RUN_ID:+--run-id "$FLR_RUN_ID"}
