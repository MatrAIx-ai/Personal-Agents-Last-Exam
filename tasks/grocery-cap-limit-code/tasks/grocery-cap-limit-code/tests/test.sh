#!/bin/sh
# Harbor verifier. Written and used for the local arithmetic check.
# A full image build was not run. Set STATE_JSON to grade one exported run.
set -eu
HERE=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
python3 "$HERE/test_outcomes.py" --check-arithmetic
if [ -z "${STATE_JSON:-}" ]; then
  exit 0
fi
if [ -n "${REWARD_JSON:-}" ]; then
  OUT=$REWARD_JSON
elif [ -d /logs/verifier ]; then
  OUT=/logs/verifier/reward.json
else
  OUT=$(dirname "$STATE_JSON")/reward.json
fi
mkdir -p "$(dirname "$OUT")"
python3 "$HERE/test_outcomes.py" --state "$STATE_JSON" --out "$OUT"
