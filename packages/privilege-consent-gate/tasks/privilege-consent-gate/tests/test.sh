#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${1:-$SCRIPT_DIR/../../../demo/privilege-consent-gate/evidence/runs/reference}"
REWARD_DIR="${2:-/logs/verifier}"

if [ -d "$REWARD_DIR" ] || mkdir -p "$REWARD_DIR" 2>/dev/null; then
  python3 "$SCRIPT_DIR/test_outcomes.py" "$RUN_DIR" --reward-dir "$REWARD_DIR"
else
  python3 "$SCRIPT_DIR/test_outcomes.py" "$RUN_DIR"
fi
