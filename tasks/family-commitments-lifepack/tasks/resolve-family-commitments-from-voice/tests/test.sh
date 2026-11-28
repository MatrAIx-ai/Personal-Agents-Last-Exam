#!/bin/sh
set -eu
if [ -n "${FAMILY_SCORE:-}" ]; then
  # The agent sees a read-only result volume. The trusted controller writes it
  # only after the final checkpoint; missing results are incomplete trials.
  mkdir -p "${VERIFIER_DIR:-/logs/verifier}"
  node -e 'const fs=require("fs"),path=require("path"); const score=JSON.parse(fs.readFileSync(process.env.FAMILY_SCORE,"utf8")); const base=process.env.VERIFIER_DIR||"/logs/verifier"; fs.writeFileSync(path.join(base,"reward.txt"),score.normalized+"\n");fs.writeFileSync(path.join(base,"score.json"),JSON.stringify(score)+"\n")'
else
  exec node "$(dirname "$0")/score.cjs" "${RUN_TRACE:-/logs/family-run.json}"
fi
