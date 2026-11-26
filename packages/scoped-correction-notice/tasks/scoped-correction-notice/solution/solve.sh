#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/../../../demo/scoped-correction-notice/evidence/runs/reference}"

node "$SCRIPT_DIR/replay.cjs" --scenario reference --out "$OUT_DIR"
