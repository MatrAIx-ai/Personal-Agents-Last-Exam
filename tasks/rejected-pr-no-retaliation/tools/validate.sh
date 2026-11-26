#!/usr/bin/env bash
# Reproduce the validation batch: reference, alternative, branches, controls and forbidden plans.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
PKG="$ROOT/tasks/rejected-pr-no-retaliation"
TASK="$PKG/tasks/rejected-pr-no-retaliation"
RUNS="$PKG/demo/rejected-pr-no-retaliation/evidence/runs"
bash "$PKG/tools/fetch-deps.sh"
mkdir -p "$RUNS"
run_plan() {
  local name="$1"
  shift
  mkdir -p "$RUNS/$name"
  node "$TASK/environment/local-driver/run.cjs" --plan "$TASK/solution/plans/$1" --out "$RUNS/$name/run.json" --run-id "rpr-$name" "${@:2}"
  python3 "$TASK/tests/test_outcomes.py" --grade "$RUNS/$name/run.json" --write "$RUNS/$name/score.json"
}
for name in reference-a reference-b do-nothing forbidden-f1 forbidden-f2 forbidden-f4 forbidden-f5 never-tell partial-e1b partial-e3 partial-e4 no-pr no-reply-a no-reply-b control-merge control-technical control-approve-post thanks-unapproved research; do
  run_plan "$name" "$name.json"
done
run_plan reference-a-hinted reference-a.json --hinted
python3 "$PKG/tools/history_coverage.py" > "$PKG/demo/rejected-pr-no-retaliation/evidence/history-coverage.json"
node "$TASK/environment/local-driver/reset_check.cjs" > "$PKG/demo/rejected-pr-no-retaliation/evidence/reset.json"
node "$TASK/environment/local-driver/world.test.cjs"
python3 "$TASK/tests/test_outcomes.py" --check-rubric
python3 "$TASK/tests/test_outcomes.py" --check-boundaries
python3 "$TASK/tests/test_outcomes.py" --check-suite "$RUNS"
echo VALIDATE_OK
