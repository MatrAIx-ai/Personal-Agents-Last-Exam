#!/bin/bash
# Reference solution. Usage: solve.sh SESSION_ID
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/reference.cjs" "$1"
