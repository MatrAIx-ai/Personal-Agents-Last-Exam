#!/bin/bash
# Verifier entry point. Scores one snapshot of every App and the chat, and writes Harbor's reward file
# plus the item-level results.
# It does not touch the Apps. The snapshot is taken in the agent's container after the session ends, and
# Harbor places it at the same path in the verifier's own container. This script and the rubric stay there.
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${PALE_LOG_DIR:-/logs/verifier}"
STATE="${PALE_STATE_FILE:-/var/pale/collect/state.json}"
mkdir -p "$LOG_DIR"

if [ ! -f "$STATE" ]; then
  echo "test.sh: no state snapshot at $STATE" >&2
  exit 1
fi
cp "$STATE" "$LOG_DIR/state.json"
node "$TESTS_DIR/test_outcomes.cjs" "$LOG_DIR/state.json" "$LOG_DIR"
