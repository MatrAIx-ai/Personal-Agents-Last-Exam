#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_DIR="${WORKSPACE_DIR:-${TASK_DIR}/environment/workspace}"
OUTPUT_DIR="${VERIFIER_OUTPUT_DIR:-/logs/verifier}"

python3 "${SCRIPT_DIR}/test_outcomes.py" \
  --workspace "${WORKSPACE_DIR}" \
  --tests-dir "${SCRIPT_DIR}" \
  --output-dir "${OUTPUT_DIR}"
